from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import requests
import json
import time
from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel
from dotenv import load_dotenv

# Carregar variáveis de ambiente do arquivo .env
load_dotenv()

# Importar lógica modular existente (agora no diretório api/)
try:
    from api.pdf_utils import generate_gtd_page
    from api.vision_utils import process_scan, get_unprocessed_inbox_notes, mark_note_as_processed, save_page_snapshot
    from api.groq_utils import process_scan_with_ai, get_weekly_review_guidance
except ImportError:
    import pdf_utils
    import vision_utils
    from pdf_utils import generate_gtd_page
    from vision_utils import process_scan, get_unprocessed_inbox_notes, mark_note_as_processed, save_page_snapshot
    from groq_utils import process_scan_with_ai, get_weekly_review_guidance

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configurações do Azure
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
TENANT_ID = os.getenv("AZURE_TENANT_ID", "common")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

def get_redirect_uri(request: Request):
    # Pega o host diretamente de onde o usuário está acessando agora
    host = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
    
    # Se o host for local (localhost ou IP local), usamos http
    # Se for remoto (Vercel), usamos obrigatoriamente https
    protocol = "https" if "vercel.app" in host or "https" in request.headers.get("x-forwarded-proto", "") else "http"
    
    if not host:
        return "http://localhost:3000/"
        
    return f"{protocol}://{host}/"

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
AUTH_BASE = "https://login.microsoftonline.com"
SCOPES = ["User.Read", "offline_access", "Tasks.ReadWrite", "Calendars.Read", "Mail.Read"]

@app.get("/api/health")
def health_check():
    return {"status": "ok", "engine": "FastAPI on Vercel"}

@app.get("/api/auth/url")
def get_auth_url(request: Request):
    redirect_uri = get_redirect_uri(request)
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
        "response_mode": "query"
    }
    url = f"{AUTH_BASE}/{TENANT_ID}/oauth2/v2.0/authorize"
    target = f"{url}?{'&'.join([f'{k}={v}' for k,v in params.items()])}"
    return {"url": target}

@app.post("/api/auth/token")
async def exchange_token(request: Request):
    data = await request.json()
    code = data.get("code")
    redirect_uri = get_redirect_uri(request)
    
    payload = {
        "client_id": CLIENT_ID,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
        "client_secret": CLIENT_SECRET
    }
    
    r = requests.post(f"{AUTH_BASE}/{TENANT_ID}/oauth2/v2.0/token", data=payload)
    return r.json()

# --- NOVAS FUNÇÕES PORTADAS DO STREAMLIT ---

def move_todo_task(token, source_list_id, task_id, target_list_id):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url_move = f"{GRAPH_BASE}/me/todo/lists/{source_list_id}/tasks/{task_id}/move"
    payload = {"targetListId": target_list_id}
    r = requests.post(url_move, headers=headers, json=payload)
    if r.status_code in [200, 201, 204]: return True
    
    # Fallback: Clone if move fails (e.g. for some specific flagged emails)
    get_url = f"{GRAPH_BASE}/me/todo/lists/{source_list_id}/tasks/{task_id}?$expand=linkedResources"
    task_data = requests.get(get_url, headers=headers).json()
    new_task = requests.post(f"{GRAPH_BASE}/me/todo/lists/{target_list_id}/tasks", headers=headers, json={
        "title": task_data.get('title'), "body": task_data.get('body'), "importance": task_data.get('importance')
    }).json()
    if 'id' in new_task:
        for res in task_data.get('linkedResources', []):
            requests.post(f"{GRAPH_BASE}/me/todo/lists/{target_list_id}/tasks/{new_task['id']}/linkedResources", headers=headers, json=res)
        requests.delete(f"{GRAPH_BASE}/me/todo/lists/{source_list_id}/tasks/{task_id}", headers=headers)
        return True
    return False

def move_outlook_email(token, message_id, folder_name):
    headers = {"Authorization": f"Bearer {token}"}
    # Busca a pasta recursivamente
    def find_folder(url):
        res = requests.get(url, headers=headers).json().get("value", [])
        for f in res:
            if f['displayName'].lower() == folder_name.lower(): return f['id']
            if f.get('childFolderCount', 0) > 0:
                found = find_folder(f"{GRAPH_BASE}/me/mailFolders/{f['id']}/childFolders")
                if found: return found
        return None
    
    f_id = find_folder(f"{GRAPH_BASE}/me/mailFolders")
    if f_id:
        requests.post(f"{GRAPH_BASE}/me/messages/{message_id}/move", headers=headers, json={"destinationId": f_id})
        return True
    return False

# --- ENDPOINTS ATUALIZADOS ---

@app.get("/api/dashboard")
def get_dashboard_data(token: str):
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Paisagem Rígida
    start = datetime.now().replace(hour=0, minute=0, second=0).isoformat() + "Z"
    end = datetime.now().replace(hour=23, minute=59, second=59).isoformat() + "Z"
    cal_res = requests.get(f"{GRAPH_BASE}/me/calendarView", headers=headers, params={"startDateTime": start, "endDateTime": end})
    
    # 2. Projetos (Planner) com PROGRESSO e Buckets GTD
    planner_res = requests.get(f"{GRAPH_BASE}/me/planner/plans", headers=headers)
    plans = planner_res.json().get("value", [])[:15]
    projects = []
    # planner_paper será expandido para ter todas as tarefas, mas com flags de prioridade
    planner_tasks_for_paper = {"projects": [], "waiting": [], "all_by_plan": {}}
    
    for plan in plans:
        tasks_res = requests.get(f"{GRAPH_BASE}/planner/plans/{plan['id']}/tasks", headers=headers).json().get("value", [])
        total = len(tasks_res)
        done = sum(1 for t in tasks_res if t.get('percentComplete') == 100)
        
        # Buscar Buckets para filtrar tarefas do papel
        buckets_res = requests.get(f"{GRAPH_BASE}/planner/plans/{plan['id']}/buckets", headers=headers).json().get("value", [])
        bucket_map = {b['id']: b['name'] for b in buckets_res}
        
        plan_all_tasks = {}
        for task in tasks_res:
            if task.get('percentComplete') == 100: continue
            b_name = bucket_map.get(task.get('bucketId'), "Sem Categoria")
            b_name_lower = b_name.lower()
            
            task_info = {"plan": plan['title'], "task": task['title'], "bucket": b_name}
            
            # Prioritários (vão pré-marcados)
            if "proxima" in b_name_lower or "próxima" in b_name_lower:
                planner_tasks_for_paper["projects"].append(task_info)
            elif "delegado" in b_name_lower:
                planner_tasks_for_paper["waiting"].append(task_info)
            
            # Agrupamento para "todas as outras"
            if b_name not in plan_all_tasks: plan_all_tasks[b_name] = []
            plan_all_tasks[b_name].append(task['title'])

        planner_tasks_for_paper["all_by_plan"][plan['title']] = plan_all_tasks

        projects.append({
            "name": plan.get("title"), "id": plan.get("id"), 
            "progress": (done / total * 100) if total > 0 else 0,
            "tasks_count": total
        })
    
    # 3. Contextos (Mostrar TODAS as listas com tarefas pendentes)
    todo_lists = requests.get(f"{GRAPH_BASE}/me/todo/lists", headers=headers).json().get("value", [])
    context_data = {}
    
    today_dt = datetime.now()
    today_str = today_dt.strftime("%Y-%m-%d")
    for lst in todo_lists:
        raw_name = lst.get("displayName")
        # Padronização GTD: Renomear a lista padrão para "Caixa de Entrada"
        name = "Caixa de Entrada" if raw_name.lower() in ["tasks", "tarefas", "in tray", "inbox"] else raw_name
        
        # Buscamos subtarefas (checklistItems) e o corpo da nota (body)
        tasks_res = requests.get(
            f"{GRAPH_BASE}/me/todo/lists/{lst['id']}/tasks", 
            headers=headers, 
            params={
                "$filter": "status ne 'completed'", 
                "$top": 100,
                "$expand": "checklistItems"
            }
        ).json()
        tasks = tasks_res.get("value", [])
        
        if tasks: 
            context_data[name] = []
            for t in tasks:
                due = t.get("dueDateTime", {}).get("dateTime", "")
                is_today = due.split('T')[0] <= today_str if due else False
                
                # Coletar subtarefas
                subtasks = []
                for st in t.get("checklistItems", []):
                    if st.get("status") != "completed":
                        subtasks.append({"id": st['id'], "title": st['displayName']})

                context_data[name].append({
                    "id": t['id'],
                    "title": t.get("title"), 
                    "is_today": is_today,
                    "has_notes": bool(t.get("body", {}).get("content")),
                    "notes": t.get("body", {}).get("content", ""),
                    "has_attachments": t.get("hasAttachments", False),
                    "subtasks": subtasks
                })

    return {
        "landscape": cal_res.json().get("value", []) if cal_res.status_code == 200 else [],
        "radar": projects,
        "contexts": context_data,
        "planner_paper": planner_tasks_for_paper,
        "sync_time": datetime.now().strftime("%H:%M")
    }

@app.get("/api/clarify")
def get_clarify_data(token: str):
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Mapear todas as pastas (tentar pegar o máximo possível)
    folders_res = requests.get(f"{GRAPH_BASE}/me/mailFolders?$top=100", headers=headers)
    folders = folders_res.json().get("value", [])
    folder_map = {f.get("id"): f.get("displayName") for f in folders}
    
    # 2. Buscar e-mails sinalizados em todo o mailbox
    mail_res = requests.get(
        f"{GRAPH_BASE}/me/messages",
        headers=headers,
        params={
            "$filter": "flag/flagStatus eq 'flagged'", 
            "$top": 80, 
            "$select": "subject,from,receivedDateTime,id,parentFolderId,body,webLink,hasAttachments"
        }
    )
    all_emails = mail_res.json().get("value", [])
    
    # 3. Categorização Robusta baseada nos prints do usuário
    categorized = {
        "acao": [],
        "aguardando": [],
        "outros": []
    }
    
    for mail in all_emails:
        p_id = mail.get("parentFolderId")
        # Se a pasta não estiver no mapa inicial, buscamos o nome dela individualmente (cache dinâmico)
        if p_id not in folder_map:
            f_detail = requests.get(f"{GRAPH_BASE}/me/mailFolders/{p_id}", headers=headers).json()
            folder_map[p_id] = f_detail.get("displayName", "Inbox")

        folder_name = folder_map.get(p_id, "").lower()
        
        # Filtros baseados nos nomes reais: @Ações, @Ação, @Aguardando Resposta
        if "@aç" in folder_name: # Pega @Ações ou @Ação
            categorized["acao"].append(mail)
        elif "@aguard" in folder_name: # Pega @Aguardando ou @Aguardando Resposta
            categorized["aguardando"].append(mail)
        else:
            categorized["outros"].append(mail)
    
    # 4. Buscar Tarefas da lista "Tasks" ou "In Tray" (Caixa de Entrada)
    tasks_list = []
    # Usamos o mesmo método de busca de listas para achar a padrão
    lists_res = requests.get(f"{GRAPH_BASE}/me/todo/lists", headers=headers).json().get("value", [])
    inbox_list = next((l for l in lists_res if l['displayName'].lower() in ["tasks", "tarefas", "in tray", "caixa de entrada", "inbox"]), lists_res[0] if lists_res else None)
    
    if inbox_list:
        tasks_res = requests.get(
            f"{GRAPH_BASE}/me/todo/lists/{inbox_list['id']}/tasks", 
            headers=headers, 
            params={"$filter": "status ne 'completed'", "$top": 50}
        ).json().get("value", [])
        for t in tasks_res:
            tasks_list.append({
                "id": t['id'],
                "list_id": inbox_list['id'],
                "text": t['title'],
                "is_task": True
            })

    return {
        "emails": categorized,
        "paper_notes": get_unprocessed_inbox_notes(),
        "inbox_tasks": tasks_list
    }

@app.post("/api/todo/quick-add")
async def quick_add_task(request: Request):
    data = await request.json()
    token = data.get("token")
    text = data.get("text")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    lists_res = requests.get(f"{GRAPH_BASE}/me/todo/lists", headers=headers).json().get("value", [])
    inbox_list = next((l for l in lists_res if l['displayName'].lower() in ["tasks", "tarefas", "in tray", "caixa de entrada", "inbox"]), lists_res[0] if lists_res else None)
    
    if inbox_list:
        requests.post(f"{GRAPH_BASE}/me/todo/lists/{inbox_list['id']}/tasks", headers=headers, json={"title": text})
        return {"status": "success"}
    return {"status": "error", "message": "Lista de entrada não encontrada"}

@app.post("/api/clarify/transform")
async def transform_email_to_task(request: Request):
    data = await request.json()
    token = data.get("token")
    email_id = data.get("email_id")
    subject = data.get("subject")
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # Criar tarefa na lista padrão (ou "In Tray")
    # Primeiro buscamos as listas para achar a "In Tray" ou usar a primeira
    lists_res = requests.get(f"{GRAPH_BASE}/me/todo/lists", headers=headers)
    lists = lists_res.json().get("value", [])
    target_list_id = lists[0].get("id") if lists else None
    
    for lst in lists:
        if lst.get("displayName") in ["In Tray", "Inbox", "Tarefas"]:
            target_list_id = lst.get("id")
            break
            
    if not target_list_id:
        return {"status": "error", "message": "Lista de tarefas não encontrada"}
        
    # Criar a tarefa
    task_payload = {
        "title": f"Processar: {subject}",
        "body": {"content": f"Gerado a partir do e-mail ID: {email_id}", "contentType": "text"}
    }
    
    create_res = requests.post(
        f"{GRAPH_BASE}/me/todo/lists/{target_list_id}/tasks",
        headers=headers,
        json=task_payload
    )
    
    if create_res.status_code == 201:
        # Opcional: Desmarcar flag do e-mail original
        return {"status": "success", "task_id": create_res.json().get("id")}
    
    return {"status": "error", "message": "Falha ao criar tarefa"}

@app.get("/api/projects/buckets")
def get_project_buckets(token: str, plan_id: str):
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{GRAPH_BASE}/planner/plans/{plan_id}/buckets", headers=headers)
    return r.json().get("value", [])

@app.post("/api/clarify/handle")
async def handle_clarify_action(request: Request):
    data = await request.json()
    token = data.get("token")
    action_type = data.get("action_type") # 'context' ou 'project'
    item = data.get("item") # Detalhes do item (ID, Titulo, etc)
    dest = data.get("destination") # ID da lista ou do projeto/bucket
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    is_email = item.get('type') == 'email'
    item_id = item.get('id')
    list_id = item.get('list_id')

    if action_type == "context":
        # Mover para lista de To Do
        if list_id and item_id:
            move_todo_task(token, list_id, item_id, dest['list_id'])
        if is_email:
            move_outlook_email(token, item_id, "@Ações")
            
    elif action_type == "project":
        # Criar no Planner + Deletar do To Do / Mover e-mail
        payload = {"planId": dest['plan_id'], "bucketId": dest['bucket_id'], "title": item['title']}
        p_task = requests.post(f"{GRAPH_BASE}/planner/tasks", headers=headers, json=payload).json()
        
        if 'id' in p_task:
            if list_id and item_id:
                requests.delete(f"{GRAPH_BASE}/me/todo/lists/{list_id}/tasks/{item_id}", headers=headers)
            if is_email:
                b_name = dest.get('bucket_name', '').lower()
                folder = "@Aguardando Resposta" if "delegado" in b_name else "@Ações"
                move_outlook_email(token, item_id, folder)

    elif action_type == "complete":
        # Marcar como concluído
        if list_id and item_id:
            requests.patch(f"{GRAPH_BASE}/me/todo/lists/{list_id}/tasks/{item_id}", headers=headers, json={"status": "completed"})
        if is_email:
            # Marcar flag como completa
            patch_url = f"{GRAPH_BASE}/me/messages/{item_id}"
            requests.patch(patch_url, headers=headers, json={"flag": {"flagStatus": "complete"}})
            # Mover para Arquivo Morto
            move_outlook_email(token, item_id, "Arquivo Morto")

    elif action_type == "trash":
        # Deletar
        if list_id and item_id:
            requests.delete(f"{GRAPH_BASE}/me/todo/lists/{list_id}/tasks/{item_id}", headers=headers)
        if is_email:
            move_outlook_email(token, item_id, "Deleted Items")

    return {"status": "success"}

@app.post("/api/projects/create")
async def create_new_project(request: Request):
    data = await request.json()
    token = data.get("token")
    title = data.get("title")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # Pegar Group ID
    groups = requests.get(f"{GRAPH_BASE}/me/memberOf", headers=headers).json().get("value", [])
    if not groups: return {"status": "error", "message": "Nenhum grupo encontrado"}
    
    # Criar Plano
    plan = requests.post(f"{GRAPH_BASE}/planner/plans", headers=headers, json={"owner": groups[0]['id'], "title": title}).json()
    if 'id' in plan:
        # Criar os 4 Buckets padrão (GTD FECD)
        buckets = ["Planejamento", "Proxima Ação", "Delegado", "Arquivo"]
        for b in buckets:
            requests.post(f"{GRAPH_BASE}/planner/buckets", headers=headers, json={"name": b, "planId": plan['id']})
        return {"status": "success", "plan_id": plan['id']}
    
    return {"status": "error"}

@app.post("/api/generate-pdf")
async def generate_pdf(request: Request):
    data = await request.json()
    # Adicionar metadados para o QR Code
    data['date'] = datetime.now().strftime("%d/%m/%Y")
    data['page_id'] = f"GTD-{int(time.time())}"
    
    pdf_buffer = generate_gtd_page(data)
    return StreamingResponse(
        pdf_buffer, 
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=gtd-mapa-{date.today()}.pdf"}
    )

@app.post("/api/upload")
async def upload_scan(request: Request):
    # Processamento base (OCR/QR)
    res = process_scan(None)
    
    # Idea 1: Refinando com IA (Otimização de Notas)
    # Aqui a IA "lê" melhor o que o OCR básico pegou
    raw_notes = ", ".join(res.get("inbox_notes", []))
    refined_notes = process_scan_with_ai(raw_notes)
    res["inbox_notes"] = refined_notes
    
    return {
        "status": "success", 
        "message": f"IA ativada! Scan processado com sucesso. {len(res['inbox_notes'])} notas capturadas.",
        "data": res
    }

@app.get("/api/weekly-review/{step}")
async def weekly_review(step: int):
    # Idea 5: Coach da Revisão Semanal (Incentivo por IA)
    guidance = get_weekly_review_guidance(step)
    if not guidance:
        return {"done": True, "message": "Parabéns, Jhonata! Sua mente está limpa e seus projetos estão em dia."}
    return guidance
