import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# Chave deve ser definida no .env ou nas variáveis do Vercel
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

# Inicialização segura do cliente
client = None
if GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except:
        client = None

def process_scan_with_ai(image_bytes=None):
    """
    Usa Llama-3.2 Vision (quando disponível) ou Llama-3 para processar o texto extraído.
    No momento, vamos usar o processamento de texto inteligente para extrair tarefas.
    """
    # Exemplo de prompt para o Llama-3 processar o que foi 'visto'
    # No futuro, se usarmos o modelo de visão diretamente:
    # model="llama-3.2-11b-vision-preview"
    
    # Para o MVP da Idea 1, vamos simular a integração com Vision mas já usando a inteligência do Llama-3 
    # para organizar o resultado do OCR (que costuma vir sujo).
    
    prompt = """
    Aja como um assistente GTD. Analise as notas capturadas no rodapé de uma folha de tarefas analógica.
    Extraia tarefas e pensamentos acionáveis.
    
    REGRAS ESPECIAIS:
    1. Se a nota parecer um compromisso com data ou hora (ex: "reunião amanhã", "dentista sexta"), adicione o prefixo "CAL: ".
    2. Se a nota mencionar que está esperando alguém, use o prefixo "@Espera: ".
    
    Exemplo de entrada: "comprar leite, dentista amanha 10h, ligar pro mecanico"
    Exemplo de saída: ["Comprar leite", "CAL: Dentista amanhã 10h", "Ligar para o mecânico"]
    
    Entrada atual: 
    """
    
    if not GROQ_API_KEY or not client:
        return ["Nota capturada (Otimização por IA indisponível)"]

    try:
        completion = client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        # Por enquanto mantemos a simulação de extração do JSON de resposta simplificada
        return ["Adicionar no pedido de Carta de Circularização as contas que não estão listadas", "Revisar contrato de aluguel", "@Espera: Resposta Bradesco"]
    except Exception as e:
        print(f"Erro no processamento de IA: {e}")
        return ["Nota capturada via fallback"]

def get_weekly_review_guidance(step_index=0):
    """
    Idea 5: Coach da Revisão Semanal.
    Retorna orientações baseadas no passo da metodologia GTD.
    """
    steps = [
        {
            "title": "📥 Esvaziar a Mente (Insurreição)",
            "guidance": "Pegue um papel ou abra o Inbox e anote TUDO que está na sua cabeça agora. Compromissos, preocupações, ideias. Não processe ainda, apenas tire de dentro de você."
        },
        {
            "title": "📧 Processar o Inbox",
            "guidance": "Olhe seu To Do (Inbox), E-mails sinalizados e Notas do Scan. Decida: Isso é acionável? Sim ou não? Se levar - de 2 min, faça agora!"
        },
        {
            "title": "🗓️ Revisar o Calendário",
            "guidance": "Olhe as últimas 2 semanas e as próximas 3. Alguma tarefa ficou para trás? Algum compromisso requer preparação?"
        },
        {
            "title": "🚀 Revisar Projetos",
            "guidance": "Olhe seu Radar de Projetos no Planner. Cada projeto tem pelo menos UMA 'Próxima Ação' definida para a próxima semana?"
        },
        {
            "title": "⏳ Revisar Lista 'Aguardando'",
            "guidance": "Veja quem você está esperando. Mande um 'follow-up' se necessário."
        },
        {
            "title": "💡 Revisar Algum dia/Talvez",
            "guidance": "Algum desses projetos deve ser ativado agora? Algum deve ser deletado porque perdeu o sentido?"
        }
    ]
    
    if step_index < len(steps):
        current_step = steps[step_index]
        
        # Inteligência Artificial como adição (não bloqueante)
        if GROQ_API_KEY and client:
            try:
                prompt = f"Aja como um coach GTD. Dê uma dica curta e motivadora para o passo: {current_step['title']}"
                completion = client.chat.completions.create(
                    model="llama3-8b-8192",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=50
                )
                current_step["ai_tip"] = completion.choices[0].message.content
            except Exception as e:
                print(f"Erro na dica da IA: {e}")
                current_step["ai_tip"] = "Respire fundo e mantenha o foco na sua clareza mental."
        else:
            current_step["ai_tip"] = "Dica: Mantenha seu ambiente de trabalho organizado durante a revisão."
            
        return current_step
def categorize_reference_with_ai(text):
    """
    Usa IA para decidir a melhor seção do OneNote para um item de referência.
    """
    prompt = f"""
    Analise o texto abaixo e decida qual a melhor SEÇÃO do OneNote para arquivá-lo como MATERIAL DE REFERÊNCIA.
    Responda APENAS o nome da categoria (ex: Financeiro, Estudos, Pessoal, Trabalho, Saúde, Viagens, Ideias).
    Seja breve.

    Texto: {text}
    Categoria:
    """
    
    if not GROQ_API_KEY or not client:
        return "Geral"

    try:
        completion = client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=20
        )
        return completion.choices[0].message.content.strip().replace(".", "")
    except:
        return "Geral"
