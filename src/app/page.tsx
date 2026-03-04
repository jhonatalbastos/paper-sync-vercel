"use client";

import React, { useState, useEffect } from "react";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Estrutura de Dados GTD Pura
  const [data, setData] = useState<{
    landscape: any[], // Paisagem Rígida (Calendário)
    radar: any[],     // Radar de Delegação (Planner)
    contexts: { [key: string]: string[] }, // Ações por Contexto (@)
    sync_time: string
  }>({
    landscape: [],
    radar: [],
    contexts: {},
    sync_time: "--:--"
  });

  const [clarifyData, setClarifyData] = useState<{
    emails: { acao: any[], aguardando: any[], outros: any[] },
    paper_notes: any[]
  }>({
    emails: { acao: [], aguardando: [], outros: [] },
    paper_notes: []
  });

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processedSession, setProcessedSession] = useState<any[]>([]);
  const [showProcessed, setShowProcessed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) handleAuthCode(code); else checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      if (activeTab === "Esclarecer") fetchClarifyData();
      if (activeTab === "Dashboard") fetchDashboardData(localStorage.getItem("ms_token"));
    }
  }, [activeTab, isAuthenticated]);

  const checkAuth = async () => {
    const token = localStorage.getItem("ms_token");
    if (token) {
      setIsAuthenticated(true);
      await fetchDashboardData(token);
    }
    setLoading(false);
  };

  const fetchDashboardData = async (token: string | null) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/dashboard?token=${token}`);
      const result = await res.json();
      if (result) setData(result);
    } catch (error) { console.error("Dashboard fetch error:", error); }
  };

  const fetchClarifyData = async () => {
    const token = localStorage.getItem("ms_token");
    try {
      const res = await fetch(`/api/clarify?token=${token}`);
      const result = await res.json();
      setClarifyData(result);
    } catch (error) { console.error("Clarify fetch error:", error); }
  };

  const transformEmailToTask = async (emailId: string, subject: string) => {
    const token = localStorage.getItem("ms_token");
    setProcessingId(emailId);
    try {
      const res = await fetch("/api/clarify/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email_id: emailId, subject }),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert("Sucesso! E-mail transformado em tarefa no seu Inbox.");
        fetchClarifyData(); // Atualizar lista
      }
    } catch (error) {
      console.error("Transform error:", error);
    } finally {
      setProcessingId(null);
    }
  };

  const generatePDF = async () => {
    try {
      const pdfData = {
        calendar: data.landscape.map(ev => ({
          time: new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          subject: ev.subject
        })),
        tasks: data.contexts,
        waiting: data.radar.map(p => ({ plan: p.name, task: "Seguir com projeto", bucket: "Radar" }))
      };

      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdfData),
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Mapa-de-Batalha-FECD.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) { alert("Erro ao gerar PDF."); }
  };

  const handleAuthCode = async (code: string) => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const authData = await res.json();
      if (authData.access_token) {
        localStorage.setItem("ms_token", authData.access_token);
        setIsAuthenticated(true);
        await fetchDashboardData(authData.access_token);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (error) { console.error("Auth error:", error); } finally { setLoading(false); }
  };

  const loginWithMicrosoft = async () => {
    try {
      const res = await fetch("/api/auth/url");
      const urlData = await res.json();
      if (urlData.url) window.location.href = urlData.url;
    } catch (error) { console.error("Login error:", error); }
  };

  const logout = () => {
    localStorage.removeItem("ms_token");
    setIsAuthenticated(false);
  };

  if (loading) return <div className="login-screen"><span className="loading-spinner"></span><p>Sincronizando Ecosystem FECD...</p></div>;

  if (!isAuthenticated) return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo-box" style={{ margin: '0 auto 1.5rem' }}>F</div>
        <h1>PaperSync 365</h1>
        <p style={{ marginBottom: '2rem' }}>Ponte Híbrida Analógico-Digital (GTD)</p>
        <button className="btn-primary" onClick={loginWithMicrosoft} style={{ width: '100%', justifyContent: 'center' }}>
          Entrar com Conta Microsoft
        </button>
      </div>
    </div>
  );

  const ClarifyForm = ({ item, type }: { item: any; type: string }) => {
    const [destination, setDestination] = useState<any>({});
    const [loading, setLoading] = useState(false);
    const [buckets, setBuckets] = useState<any[]>([]);

    const fetchBuckets = async (planId: string) => {
      const token = localStorage.getItem("ms_token");
      const res = await fetch(`/api/projects/buckets?token=${token}&plan_id=${planId}`);
      const b = await res.json();
      setBuckets(b);
    };

    const handleAction = async (actionType: 'context' | 'project') => {
      setLoading(true);
      const token = localStorage.getItem("ms_token");

      const payload = {
        token,
        action_type: actionType,
        item: {
          id: item.id,
          title: item.subject || item.title || item.text,
          list_id: item.parentFolderId, // Para To Do
          email_id: item.id // Se for e-mail
        },
        destination: {
          list_id: destination.list_id,
          plan_id: destination.plan_id,
          bucket_id: destination.bucket_id,
          bucket_name: buckets.find(b => b.id === destination.bucket_id)?.name
        }
      };

      const res = await fetch("/api/clarify/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setProcessedSession(prev => [{ ...item, processedAt: new Date().toLocaleTimeString() }, ...prev]);
        alert("Processado com sucesso!");
        fetchClarifyData();
        const tokenToken = localStorage.getItem("ms_token");
        fetchDashboardData(tokenToken);
      }
      setLoading(false);
    };

    return (
      <div className="fecd-card" style={{ marginBottom: '16px', borderLeft: '4px solid var(--m3-primary)' }}>
        <p style={{ fontWeight: 600, marginBottom: '12px' }}>{item.subject || item.text}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Coluna To Do */}
          <div style={{ background: 'var(--m3-surface-container-low)', padding: '12px', borderRadius: '12px' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '8px', color: 'var(--m3-primary)' }}>CONTEXTO (To Do)</p>
            <select
              className="m3-select"
              onChange={(e) => setDestination({ ...destination, list_id: e.target.value })}
              style={{ width: '100%', marginBottom: '8px' }}
            >
              <option value="">-- Mover para --</option>
              {Object.keys(data.contexts).map(ctx => (
                <option key={ctx} value={ctx}>{ctx}</option>
              ))}
            </select>
            <button
              className="btn-primary"
              disabled={loading || !destination.list_id}
              style={{ width: '100%', fontSize: '0.8rem' }}
              onClick={() => handleAction('context')}
            >
              Confirmar Contexto
            </button>
          </div>

          {/* Coluna Planner */}
          <div style={{ background: 'var(--m3-surface-container-low)', padding: '12px', borderRadius: '12px' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '8px', color: 'var(--m3-secondary)' }}>PROJETO (Planner)</p>
            <select
              className="m3-select"
              onChange={(e) => {
                setDestination({ ...destination, plan_id: e.target.value });
                fetchBuckets(e.target.value);
              }}
              style={{ width: '100%', marginBottom: '4px' }}
            >
              <option value="">-- Plano --</option>
              {data.radar.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {buckets.length > 0 && (
              <select
                className="m3-select"
                onChange={(e) => setDestination({ ...destination, bucket_id: e.target.value })}
                style={{ width: '100%', marginBottom: '8px' }}
              >
                <option value="">-- Bucket --</option>
                {buckets.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <button
              className="btn-primary"
              disabled={loading || !destination.plan_id || !destination.bucket_id}
              style={{ width: '100%', fontSize: '0.8rem', background: 'var(--m3-secondary-container)', color: 'var(--m3-on-secondary-container)' }}
              onClick={() => handleAction('project')}
            >
              Mover p/ Projeto
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "Esclarecer":
        const toggleSection = (section: string) => {
          setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
        };

        const renderSection = (title: string, items: any[], sectionId: string, icon: string) => {
          const isExpanded = expandedSections[sectionId];
          const displayItems = isExpanded ? items : items.slice(0, 5);

          return (
            <div style={{ marginBottom: '32px' }}>
              <h3 className="card-title" style={{ justifyContent: 'flex-start', gap: '12px' }}>
                {icon} {title} ({items.length})
              </h3>
              <div className="dashboard-grid"> {/* Agora é flex-direction: column no CSS */}
                {displayItems.map((item, i) => (
                  <ClarifyForm key={`${sectionId}-${item.id || i}`} item={item} type={sectionId} />
                ))}
                {items.length === 0 && (
                  <div className="fecd-card" style={{ opacity: 0.7 }}>Nenhum item pendente nesta categoria.</div>
                )}
                {items.length > 5 && (
                  <button
                    className="btn-primary"
                    style={{ background: 'var(--m3-surface-variant)', color: 'var(--m3-on-surface)', width: '200px', alignSelf: 'center', marginTop: '8px' }}
                    onClick={() => toggleSection(sectionId)}
                  >
                    {isExpanded ? "🔼 Mostrar Menos" : `🔽 Ver mais ${items.length - 5} itens`}
                  </button>
                )}
              </div>
            </div>
          );
        };

        return (
          <div className="tab-content" style={{ maxWidth: '900px', margin: '0 auto' }}>
            <header className="header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="page-title">🧠 Fase 2: Esclarecer</h2>
                <p className="page-subtitle">Decida o destino de cada captura. To Do ou Planner?</p>
              </div>
              <button
                className="btn-primary"
                onClick={() => setShowProcessed(!showProcessed)}
                style={{ background: showProcessed ? 'var(--m3-primary)' : 'var(--m3-surface-variant)', color: showProcessed ? 'var(--m3-on-primary)' : 'var(--m3-on-surface)' }}
              >
                {showProcessed ? "🙈 Esconder Esclarecidos" : `👁️ Ver Esclarecidos (${processedSession.length})`}
              </button>
            </header>

            <div className="clarify-stack" style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Lista de Processados (Quarta Lista) */}
              {showProcessed && (
                <div style={{ marginBottom: '40px', padding: '24px', background: 'var(--m3-surface-container-highest)', borderRadius: '24px', border: '2px dashed var(--m3-primary)' }}>
                  <h3 className="card-title" style={{ color: 'var(--m3-primary)' }}>✅ Itens Esclarecidos nesta Sessão</h3>
                  <div className="dashboard-grid">
                    {processedSession.map((item, i) => (
                      <div key={`proc-${i}`} className="fecd-card" style={{ opacity: 0.8, background: 'var(--m3-surface-container-low)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600 }}>{item.subject || item.text}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--m3-primary)' }}>Processado às {item.processedAt}</span>
                        </div>
                      </div>
                    ))}
                    {processedSession.length === 0 && <p>Nenhum item esclarecido ainda.</p>}
                  </div>
                </div>
              )}

              {renderSection("Capturas Digitais (@Ações)", clarifyData.emails.acao, "acao", "⚡")}
              {renderSection("Radar de Delegação (@Aguardando)", clarifyData.emails.aguardando, "aguardando", "⏳")}
              {renderSection("Demais Sinalizados", clarifyData.emails.outros, "outros", "📧")}
              {renderSection("Capturas Analógicas (Papel)", clarifyData.paper_notes, "paper", "📝")}
            </div>
          </div>
        );
      case "Projetos":
        return (
          <div className="tab-content text-center">
            <header className="header-row">
              <div><h2 className="page-title">🤝 Radar de Delegação</h2><p className="page-subtitle">Acompanhamento e status dos Projetos no Planner.</p></div>
              <button className="btn-primary" onClick={() => setActiveTab("Dashboard")}>+ Novo Projeto</button>
            </header>
            <div className="dashboard-grid">
              {data.radar.map((p: any, i: number) => (
                <div key={i} className="fecd-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>{p.name}</h3>
                    <span className="badge">{Math.round(p.progress)}%</span>
                  </div>
                  <div className="progress-bar-bg" style={{ marginBottom: '16px' }}>
                    <div className="progress-bar-fill" style={{ width: `${p.progress}%` }}></div>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--m3-on-surface-variant)' }}>
                    {p.tasks_count} tarefas totais identificadas.
                  </p>
                  <button
                    className="btn-primary"
                    style={{ width: '100%', marginTop: '16px', background: 'var(--m3-surface-variant)', color: 'var(--m3-on-surface)' }}
                    onClick={() => window.open(`https://tasks.office.com/fecd.org.br/Home/PlanDetails/${p.id}`, '_blank')}
                  >
                    Abrir no Planner
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      case "Impressao":
        return (
          <div className="tab-content">
            <header className="header-row">
              <div><h2 className="page-title">🖨️ Mapa de Batalha</h2><p className="page-subtitle">Gere sua folha A4 diária com QR Code.</p></div>
            </header>
            <div className="fecd-card" style={{ maxWidth: '500px', margin: '0 auto' }}>
              <h3 className="card-title">Configurar Impressão</h3>
              <p style={{ marginBottom: '1.5rem', color: 'var(--m3-on-surface-variant)' }}>Isso consolidará sua Paisagem Rígida e Ações por Contexto.</p>
              <button className="btn-primary" onClick={generatePDF} style={{ width: '100%', justifyContent: 'center' }}>
                Gerar PDF (A4)
              </button>
            </div>
          </div>
        );
      default:
        return (
          <>
            <header className="header-row">
              <div>
                <h2 className="page-title">Bem-vindo, Jhonata</h2>
                <p className="page-subtitle">Sincronizado via Microsoft Graph às {data.sync_time}.</p>
              </div>
              <button className="btn-primary" onClick={() => fetchDashboardData(localStorage.getItem("ms_token"))}>
                🔄 Atualizar
              </button>
            </header>

            <div className="dashboard-grid">
              {/* Paisagem Rígida */}
              <div className="fecd-card">
                <h3 className="card-title">🕒 Paisagem Rígida (Hoje)</h3>
                <div className="list">
                  {data.landscape.length > 0 ? data.landscape.map((ev, i) => (
                    <div key={i} className="list-item">
                      <span style={{ fontWeight: 700, color: 'var(--m3-primary)', minWidth: '60px' }}>
                        {new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>{ev.subject}</span>
                    </div>
                  )) : <p>Sem compromissos fixos para hoje.</p>}
                </div>
              </div>

              <div className="fecd-card">
                <h3 className="card-title">🤝 Radar de Projetos</h3>
                {data.radar.slice(0, 3).map((p: any, i: number) => (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                      <span>{p.name}</span>
                      <span>{Math.round(p.progress)}%</span>
                    </div>
                    <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${p.progress}%` }}></div></div>
                  </div>
                ))}
              </div>

              {Object.entries(data.contexts).map(([ctx, tasks]: [string, any], i) => (
                <div key={i} className="fecd-card">
                  <h3 className="card-title">🚀 {ctx}</h3>
                  <div className="list">
                    {tasks.map((t: string, idx: number) => (
                      <div key={idx} className="list-item">
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
    }
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-box">F</div>
          <div>
            <h1 style={{ fontWeight: 700, fontSize: '1.25rem', lineHeight: 1 }}>Ecosystem</h1>
            <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>PaperSync 365</p>
          </div>
        </div>

        <nav className="nav-menu">
          {[
            { id: "Dashboard", label: "Dashboard", icon: "📊" },
            { id: "Esclarecer", label: "Esclarecer", icon: "🧠" },
            { id: "Projetos", label: "Projetos", icon: "🤝" },
            { id: "Impressao", label: "Impressão", icon: "🖨️" },
            { id: "Upload", label: "Escaneamento", icon: "📸" }
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            >
              <span>{item.icon}</span>
              <p>{item.label}</p>
            </div>
          ))}

          <div className="nav-item" onClick={logout} style={{ marginTop: 'auto' }}>
            <span>🚪</span>
            <p>Sair</p>
          </div>
        </nav>
      </aside>

      <main className="main-content">
        {renderContent()}

        <footer style={{ marginTop: '4rem', opacity: 0.5, textAlign: 'center', paddingBottom: '2rem' }}>
          <p style={{ fontSize: '0.75rem' }}>FECD PREMIUM GTD SYSTEM &copy; 2026</p>
        </footer>
      </main>
    </div>
  );
}
