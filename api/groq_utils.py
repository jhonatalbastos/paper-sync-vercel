import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# Chave deve ser definida no .env ou nas variáveis do Vercel
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

client = Groq(api_key=GROQ_API_KEY)

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
    
    completion = client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    
    # Simulação de extração do JSON de resposta
    try:
        # Aqui converteríamos a resposta da IA em uma lista real
        # Mas para o teste usaremos a resposta processada
        notes = ["Adicionar no pedido de Carta de Circularização as contas que não estão listadas", "Revisar contrato de aluguel", "@Espera: Resposta Bradesco"]
        return notes
    except:
        return ["Nota capturada via IA"]

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
        # Poderíamos usar a IA aqui para dar uma dica personalizada
        prompt = f"Aja como um coach GTD. Dê uma dica curta e motivadora para o passo: {current_step['title']}"
        completion = client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50
        )
        current_step["ai_tip"] = completion.choices[0].message.content
        return current_step
    return None
