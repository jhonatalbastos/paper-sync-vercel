"use client";

import React, { useState, useEffect } from "react";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Estrutura de Dados GTD Pura
  interface GTDData {
    landscape: any[];
    radar: any[];
    contexts: { [key: string]: string[] };
    sync_time: string;
  }

  interface ClarifyData {
    emails: { acao: any[]; aguardando: any[]; outros: any[] };
    paper_notes: any[];
  }

  const [data, setData] = useState<GTDData>({
    landscape: [],
    radar: [],
    contexts: {},
    sync_time: "--:--"
  });

  const [clarifyData, setClarifyData] = useState<ClarifyData>({
    emails: { acao: [], aguardando: [], outros: [] },
    paper_notes: []
  });

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processedSession, setProcessedSession] = useState<any[]>([]);
  const [showProcessed, setShowProcessed] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("archived_projects");
    if (saved) setArchivedProjects(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("archived_projects", JSON.stringify(archivedProjects));
  }, [archivedProjects]);
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
    const [destination, setDestination] = useState<{ list_id?: string; plan_id?: string; bucket_id?: string }>({});
    const [loadingForm, setLoadingForm] = useState(false);
    const [buckets, setBuckets] = useState<any[]>([]);
    const [isViewing, setIsViewing] = useState(false);
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");

    const fetchBuckets = async (planId: string) => {
      const token = localStorage.getItem("ms_token");
      const res = await fetch(`/api/projects/buckets?token=${token}&plan_id=${planId}`);
      const b = await res.json();
      setBuckets(b);
    };

    const handleCreateProject = async () => {
      setLoadingForm(true);
      const token = localStorage.getItem("ms_token");
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, title: newProjectName || item.subject || item.text })
      });
      const result = await res.json();
      if (result.status === "success") {
        setDestination({ ...destination, plan_id: result.plan_id });
        setIsCreatingProject(false);
        fetchBuckets(result.plan_id);
        fetchDashboardData(token);
      }
      setLoadingForm(false);
    };

    const handleAction = async (actionType: 'context' | 'project' | 'complete' | 'trash') => {
      setLoadingForm(true);
      const token = localStorage.getItem("ms_token");

      const payload = {
        token,
        action_type: actionType,
        item: {
          id: item.id,
          title: newProjectName || item.subject || item.title || item.text,
          list_id: item.parentFolderId,
          email_id: item.id
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
        fetchClarifyData();
        fetchDashboardData(token);
      }
      setLoadingForm(false);
    };

    const [attachments, setAttachments] = useState<any[]>([]);
    const [loadingAttachments, setLoadingAttachments] = useState(false);
    const [showAttachments, setShowAttachments] = useState(false);

    const fetchAttachments = async () => {
      if (attachments.length > 0) {
        setShowAttachments(!showAttachments);
        return;
      }
      setLoadingAttachments(true);
      const token = localStorage.getItem("ms_token");
      try {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${item.id}/attachments`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        setAttachments(data.value || []);
        setShowAttachments(true);
      } catch (e) { console.error(e); }
      setLoadingAttachments(false);
    };

    return (
      <div className="fecd-card compact-clarify-card" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: '8px', right: '12px', display: 'flex', gap: '6px' }}>
          <button onClick={() => handleAction('complete')} title="Concluir (2 min)" className="icon-btn" style={{ background: 'var(--m3-primary-container)', color: 'var(--m3-on-primary-container)', fontSize: '0.8rem' }}>✅</button>
          <button onClick={() => handleAction('trash')} title="Lixeira" className="icon-btn" style={{ background: '#ffebee', color: '#c62828', fontSize: '0.8rem' }}>🗑️</button>
        </div>

        <div style={{ paddingRight: '80px' }}>
          <p style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '4px', color: 'var(--m3-on-surface)', lineHeight: 1.2 }}>{item.subject || item.text}</p>
          {item.body && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '6px' }}>
              <button
                onClick={() => setIsViewing(!isViewing)}
                style={{ fontSize: '0.65rem', color: 'var(--m3-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
              >
                {isViewing ? "🔼 Recolher conteúdo" : "🔽 Espiar e-mail"}
              </button>

              {item.webLink && (
                <a
                  href={item.webLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.65rem', color: 'var(--m3-secondary)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}
                >
                  🔗 Ver no Outlook
                </a>
              )}

              {item.hasAttachments && (
                <button
                  onClick={fetchAttachments}
                  style={{ fontSize: '0.65rem', color: '#af52bf', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                >
                  {loadingAttachments ? "⌛ Carregando..." : "📎 Anexos"}
                </button>
              )}
            </div>
          )}

          {showAttachments && attachments.length > 0 && (
            <div style={{ background: 'var(--m3-primary-container)', padding: '6px 12px', borderRadius: '8px', marginBottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {attachments.map((att: any) => (
                <a
                  key={att.id}
                  href={`data:${att.contentType};base64,${att.contentBytes}`}
                  download={att.name}
                  style={{ fontSize: '0.7rem', color: 'var(--m3-on-primary-container)', textDecoration: 'none', background: 'white', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--m3-primary)' }}
                >
                  📥 {att.name}
                </a>
              ))}
            </div>
          )}

          {isViewing && item.body && (
            <div
              className="email-preview-container"
              dangerouslySetInnerHTML={{ __html: item.body.content }}
            />
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '12px' }}>
          <div style={{ background: 'var(--m3-surface-2)', padding: '8px 12px', borderRadius: '10px' }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, marginBottom: '6px', color: 'var(--m3-primary)', textTransform: 'uppercase' }}>Contexto</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                className="m3-select"
                onChange={(e) => setDestination({ ...destination, list_id: e.target.value })}
                style={{ flex: 1, height: '30px', fontSize: '0.75rem' }}
              >
                <option value="">-- Lista --</option>
                {Object.keys(data.contexts).map(ctx => (
                  <option key={ctx} value={ctx}>{ctx}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={loadingForm || !destination.list_id} style={{ height: '30px', padding: '0 10px', fontSize: '0.7rem' }} onClick={() => handleAction('context')}>Mover</button>
            </div>
          </div>

          <div style={{ background: 'var(--m3-surface-2)', padding: '8px 12px', borderRadius: '10px' }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, marginBottom: '6px', color: 'var(--m3-secondary)', textTransform: 'uppercase' }}>Projeto</p>
            {!isCreatingProject ? (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <select
                  className="m3-select"
                  value={destination.plan_id || ""}
                  onChange={(e) => {
                    if (e.target.value === "NEW") setIsCreatingProject(true);
                    else {
                      setDestination({ ...destination, plan_id: e.target.value });
                      fetchBuckets(e.target.value);
                    }
                  }}
                  style={{ flex: 1, minWidth: '100px', height: '30px', fontSize: '0.75rem' }}
                >
                  <option value="">-- Plano --</option>
                  <option value="NEW" style={{ fontWeight: 600, color: 'var(--m3-primary)' }}>+ Novo Projeto</option>
                  {data.radar.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {buckets.length > 0 && (
                  <select
                    className="m3-select"
                    onChange={(e) => setDestination({ ...destination, bucket_id: e.target.value })}
                    style={{ flex: 1, minWidth: '80px', height: '30px', fontSize: '0.75rem' }}
                  >
                    <option value="">-- Bucket --</option>
                    {buckets.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
                <button
                  className="btn-primary"
                  disabled={loadingForm || !destination.plan_id || !destination.bucket_id}
                  style={{ height: '30px', padding: '0 10px', fontSize: '0.7rem', background: 'var(--m3-secondary-container)', color: 'var(--m3-on-secondary-container)' }}
                  onClick={() => handleAction('project')}
                >
                  🚀 Enviar
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  placeholder="Nome do Novo Projeto"
                  className="m3-input"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  style={{ flex: 1, height: '30px', fontSize: '0.75rem' }}
                  autoFocus
                />
                <button className="btn-primary" onClick={handleCreateProject} disabled={loadingForm} style={{ height: '30px', padding: '0 10px', fontSize: '0.7rem' }}>💾</button>
                <button className="btn-primary" onClick={() => setIsCreatingProject(false)} style={{ background: 'none', color: 'var(--m3-outline)', border: '1px solid var(--m3-outline)', height: '30px', padding: '0 10px', fontSize: '0.7rem' }}>✖</button>
              </div>
            )}
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
              <h3 className="card-title" style={{ justifyContent: 'flex-start', gap: '12px', fontSize: '1rem' }}>
                {icon} {title} ({items.length})
              </h3>
              <div className="dashboard-grid">
                {displayItems.map((item, i) => (
                  <ClarifyForm key={`${sectionId}-${item.id || i}`} item={item} type={sectionId} />
                ))}
                {items.length === 0 && (
                  <div className="fecd-card" style={{ opacity: 0.7, padding: '12px' }}>Nenhum item pendente nesta categoria.</div>
                )}
                {items.length > 5 && (
                  <button
                    className="btn-primary"
                    style={{ background: 'var(--m3-surface-variant)', color: 'var(--m3-on-surface)', minWidth: '200px', alignSelf: 'center', marginTop: '8px' }}
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
          <div className="tab-content" style={{ width: '100%', margin: '0 auto' }}>
            <header className="header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="page-title">🧠 Esclarecer</h2>
                <p className="page-subtitle">Decida o destino de cada captura.</p>
              </div>
              <button
                className="btn-primary"
                onClick={() => setShowProcessed(!showProcessed)}
                style={{ background: showProcessed ? 'var(--m3-primary)' : 'var(--m3-surface-variant)', color: showProcessed ? 'var(--m3-on-primary)' : 'var(--m3-on-surface)' }}
              >
                {showProcessed ? "🙈 Esconder Histórico" : `👁️ Histórico (${processedSession.length})`}
              </button>
            </header>

            <div className="clarify-stack" style={{ display: 'flex', flexDirection: 'column' }}>
              {showProcessed && (
                <div style={{ marginBottom: '32px', padding: '16px', background: 'var(--m3-surface-2)', borderRadius: '16px', border: '2px dashed var(--m3-outline)' }}>
                  <h3 className="card-title" style={{ color: 'var(--m3-primary)', fontSize: '0.9rem' }}>✅ Processados nesta sessão</h3>
                  <div className="dashboard-grid">
                    {processedSession.map((item, i) => (
                      <div key={`proc-${i}`} className="list-item" style={{ background: 'var(--m3-surface-1)', borderRadius: '8px' }}>
                        <span style={{ fontWeight: 600, flex: 1 }}>{item.subject || item.text}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--m3-primary)' }}>{item.processedAt}</span>
                      </div>
                    ))}
                    {processedSession.length === 0 && <p style={{ fontSize: '0.8rem' }}>Nenhum item processado.</p>}
                  </div>
                </div>
              )}

              {renderSection("Capturas Digitais (@Ações)", clarifyData.emails.acao, "acao", "⚡")}
              {renderSection("Radar de Delegação (@Aguardando)", clarifyData.emails.aguardando, "aguardando", "⏳")}
              {renderSection("Demais Sinalizados", clarifyData.emails.outros, "outros", "📧")}
              {renderSection("Capturas Analógicas", clarifyData.paper_notes, "paper", "📝")}
            </div>
          </div>
        );
      case "Projetos":
        const activeProjects = data.radar.filter((p: any) => !archivedProjects.includes(p.id));
        const completedProjectsList = data.radar.filter((p: any) => archivedProjects.includes(p.id));

        return (
          <div className="tab-content" style={{ width: '100%', margin: '0 auto' }}>
            <header className="header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="page-title">🤝 Radar de Delegação</h2>
                <p className="page-subtitle">Acompanhamento e status dos Projetos no Planner.</p>
              </div>
              <button className="btn-primary" onClick={() => setActiveTab("Esclarecer")}>+ Vincular Projeto</button>
            </header>

            <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {activeProjects.map((p: any, i: number) => (
                <div key={i} className="fecd-card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'flex-start' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, flex: 1, paddingRight: '10px' }}>{p.name}</h3>
                    <span className="badge" style={{ background: p.progress === 100 ? '#e8f5e9' : 'var(--m3-secondary-container)', color: p.progress === 100 ? '#2e7d32' : 'var(--m3-on-secondary-container)' }}>
                      {Math.round(p.progress)}%
                    </span>
                  </div>
                  <div className="progress-bar-bg" style={{ marginBottom: '16px' }}>
                    <div className="progress-bar-fill" style={{ width: `${p.progress}%`, background: p.progress === 100 ? '#4caf50' : 'var(--m3-primary)' }}></div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-primary"
                      style={{ flex: 2, background: 'var(--m3-surface-variant)', color: 'var(--m3-on-surface)' }}
                      onClick={() => window.open(`https://planner.cloud.microsoft/home/planner/projects/${p.id}`, '_blank')}
                    >
                      Abrir no Planner
                    </button>
                    {p.progress === 100 && (
                      <button
                        className="btn-primary"
                        style={{ flex: 1, background: '#e8f5e9', color: '#2e7d32' }}
                        onClick={() => setArchivedProjects([...archivedProjects, p.id])}
                      >
                        ✅ Encerrar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {completedProjectsList.length > 0 && (
              <div style={{ marginTop: '48px' }}>
                <h3 className="card-title" style={{ opacity: 0.6, fontSize: '0.9rem' }}>📂 Projetos Encerrados</h3>
                <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', opacity: 0.6 }}>
                  {completedProjectsList.map((p: any, i: number) => (
                    <div key={`arch-${i}`} className="fecd-card" style={{ padding: '12px', background: 'var(--m3-surface-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.name}</span>
                        <button
                          style={{ background: 'none', border: 'none', color: 'var(--m3-primary)', fontSize: '0.7rem', cursor: 'pointer' }}
                          onClick={() => setArchivedProjects(archivedProjects.filter(id => id !== p.id))}
                        >
                          Reativar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      case "Impressao":
        return (
          <div className="tab-content">
            <header className="header-row">
              <div><h2 className="page-title">🖨️ Mapa de Batalha</h2><p className="page-subtitle">Gere sua folha A4 diária.</p></div>
            </header>
            <div className="fecd-card" style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
              <h3 className="card-title" style={{ justifyContent: 'center' }}>Configurar Impressão</h3>
              <p style={{ marginBottom: '1.5rem', color: 'var(--m3-on-surface-variant)', fontSize: '0.85rem' }}>Isso consolidará sua Paisagem Rígida e Ações por Contexto.</p>
              <button className="btn-primary" onClick={generatePDF} style={{ width: '100%', justifyContent: 'center' }}>
                Gerar PDF (A4)
              </button>
            </div>
          </div>
        );
      case "Upload":
        return (
          <div className="tab-content">
            <header className="header-row">
              <div><h2 className="page-title">📸 Escaneamento</h2><p className="page-subtitle">Capture suas notas analógicas da folha A4.</p></div>
            </header>
            <div className="fecd-card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
              <div style={{ padding: '40px 20px', border: '2px dashed var(--m3-outline-variant)', borderRadius: '20px', marginBottom: '20px' }}>
                <span style={{ fontSize: '3rem', display: 'block', marginBottom: '16px' }}>📤</span>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>Selecione o scan da sua folha</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--m3-on-surface-variant)', marginBottom: '24px' }}>Formatos suportados: PNG, JPG, JPEG</p>
                <input
                  type="file"
                  id="scan-upload"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setLoading(true);
                      const formData = new FormData();
                      formData.append('file', file);
                      try {
                        const res = await fetch('/api/upload', {
                          method: 'POST',
                          body: formData
                        });
                        const result = await res.json();
                        alert(result.message || "Folha processada com sucesso!");
                        if (activeTab === "Upload") fetchClarifyData();
                      } catch (err) {
                        console.error(err);
                        alert("Erro ao processar scan.");
                      } finally {
                        setLoading(false);
                      }
                    }
                  }}
                />
                <button
                  className="btn-primary"
                  onClick={() => document.getElementById('scan-upload')?.click()}
                  style={{ width: '200px', justifyContent: 'center' }}
                >
                  Selecionar Arquivo
                </button>
              </div>
              <div style={{ textAlign: 'left', background: 'var(--m3-surface-2)', padding: '16px', borderRadius: '12px' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '8px', color: 'var(--m3-primary)' }}>Como funciona:</h4>
                <ul style={{ fontSize: '0.75rem', color: 'var(--m3-on-surface-variant)', margin: 0, paddingLeft: '20px' }}>
                  <li>Tire uma foto nítida da sua folha de tarefas.</li>
                  <li>O sistema usará IA para ler suas marcações na "Caixa de Captura".</li>
                  <li>As notas aparecerão automaticamente na aba <strong>Esclarecer</strong>.</li>
                </ul>
              </div>
            </div>
          </div>
        );
      case "Guia":
        return (
          <div className="tab-content">
            <header className="header-row">
              <div><h2 className="page-title">📖 Guia do Ecossistema</h2><p className="page-subtitle">Como dominar seu fluxo GTD no PaperSync 365.</p></div>
            </header>

            <div className="dashboard-grid" style={{ gap: '20px' }}>
              <div className="fecd-card">
                <h3 className="card-title" style={{ color: 'var(--m3-primary)' }}>1. 🚀 Microsoft To Do: Contextos e Ação</h3>
                <p style={{ fontSize: '0.85rem', marginBottom: '12px' }}>O To Do é onde vivem suas <strong>Próximas Ações</strong> (passos únicos). O sistema organiza e busca nestas listas:</p>
                <div style={{ background: 'var(--m3-surface-2)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <p>• <strong>Tasks (Inbox):</strong> Para onde tudo que você captura no papel ou dita cai inicialmente.</p>
                  <p>• <strong>@Escritório / @Computador:</strong> Listas baseadas em onde você está ou o que tem em mãos.</p>
                  <p>• <strong>Assuntos a Tratar:</strong> Pouso para pautas de reuniões rápidas.</p>
                </div>
              </div>

              <div className="fecd-card">
                <h3 className="card-title" style={{ color: 'var(--m3-secondary)' }}>2. 🎯 Microsoft Planner: Projetos</h3>
                <p style={{ fontSize: '0.85rem', marginBottom: '12px' }}>Cada <strong>Plano</strong> é um Projeto. O App monitora o progresso através dos Buckets:</p>
                <div style={{ background: 'var(--m3-surface-2)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <p>• <strong>Bucket "Próxima Ação":</strong> O que estiver aqui aparece no topo do seu papel impresso.</p>
                  <p>• <strong>Bucket "Delegado":</strong> Alimenta seu Radar de Delegação automático.</p>
                  <p>• <strong>Progresso:</strong> Tarefas marcadas como concluídas no Planner atualizam o gráfico aqui em tempo real.</p>
                </div>
              </div>

              <div className="fecd-card">
                <h3 className="card-title" style={{ color: '#e91e63' }}>3. 📧 Microsoft Outlook: Captura Inteligente</h3>
                <p style={{ fontSize: '0.85rem', marginBottom: '12px' }}>Fluxo de processamento de e-mails sinalizados:</p>
                <div style={{ background: 'var(--m3-surface-2)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <p>• <strong>Bandeirinha (Flag):</strong> Sinalize e-mails que levam + de 2 minutos.</p>
                  <p>• <strong>Esclarecer:</strong> Use a aba Esclarecer no App para decidir: Contexto ou Projeto? O App move o e-mail para a pasta correta (ex: @Ações) automaticamente.</p>
                </div>
              </div>

              <div className="fecd-card">
                <h3 className="card-title">4. ✍️ Integração Analógica (Papel)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ background: 'var(--m3-primary-container)', color: 'var(--m3-on-primary-container)', padding: '12px', borderRadius: '8px' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Capturar</h4>
                    <p style={{ fontSize: '0.75rem' }}>Escreva na "Caixa de Captura" do papel. Não se preocupe em organizar agora, apenas tire da cabeça.</p>
                  </div>
                  <div style={{ background: 'var(--m3-secondary-container)', color: 'var(--m3-on-secondary-container)', padding: '12px', borderRadius: '8px' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Escalabilidade</h4>
                    <p style={{ fontSize: '0.75rem' }}>Ao final do dia, use o Scan do App. A IA lê suas anotações e as envia para o Inbox digital para decisão posterior.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <>
            <header className="header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="page-title" style={{ fontSize: '1.5rem' }}>Bem-vindo, Jhonata</h2>
                <p className="page-subtitle">Sincronizado às {data.sync_time}.</p>
              </div>
              <button className="btn-primary" onClick={() => fetchDashboardData(localStorage.getItem("ms_token"))}>
                🔄 Atualizar
              </button>
            </header>

            <div className="dashboard-grid">
              <div className="fecd-card">
                <h3 className="card-title" style={{ fontSize: '0.9rem' }}>🕒 Paisagem Rígida (Hoje)</h3>
                <div className="list">
                  {data.landscape.length > 0 ? data.landscape.map((ev, i) => (
                    <div key={i} className="list-item" style={{ padding: '4px 0' }}>
                      <span style={{ fontWeight: 700, color: 'var(--m3-primary)', minWidth: '50px', fontSize: '0.75rem' }}>
                        {new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: '0.85rem' }}>{ev.subject}</span>
                    </div>
                  )) : <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>Sem compromissos hoje.</p>}
                </div>
              </div>

              <div className="fecd-card">
                <h3 className="card-title" style={{ fontSize: '0.9rem' }}>🤝 Radar de Projetos</h3>
                {data.radar.slice(0, 4).map((p: any, i: number) => (
                  <div key={i} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
                      <span>{p.name}</span>
                      <span style={{ fontWeight: 600 }}>{Math.round(p.progress)}%</span>
                    </div>
                    <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${p.progress}%` }}></div></div>
                  </div>
                ))}
              </div>

              {Object.entries(data.contexts).map(([ctx, tasks], i) => (
                <div key={i} className="fecd-card">
                  <h3 className="card-title" style={{ fontSize: '0.9rem' }}>🚀 {ctx}</h3>
                  <div className="list">
                    {tasks.map((t, idx) => (
                      <div key={idx} className="list-item" style={{ fontSize: '0.85rem', padding: '3px 0' }}>• {t}</div>
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
            <h1 style={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1 }}>Ecosystem</h1>
            <p style={{ fontSize: '0.65rem', opacity: 0.7 }}>PaperSync 365</p>
          </div>
        </div>

        <nav className="nav-menu">
          {[
            { id: "Dashboard", label: "Dashboard", icon: "📊" },
            { id: "Esclarecer", label: "Esclarecer", icon: "🧠" },
            { id: "Projetos", label: "Radar", icon: "🤝" },
            { id: "Impressao", label: "Mapa", icon: "🖨️" },
            { id: "Upload", label: "Scan", icon: "📸" },
            { id: "Guia", label: "Guia", icon: "📖" }
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            >
              <span style={{ fontSize: '1rem' }}>{item.icon}</span>
              <p style={{ margin: 0 }}>{item.label}</p>
            </div>
          ))}

          <div className="nav-item" onClick={logout} style={{ marginTop: 'auto' }}>
            <span style={{ fontSize: '1rem' }}>🚪</span>
            <p style={{ margin: 0 }}>Sair</p>
          </div>
        </nav>
      </aside>

      <main className="main-content">
        {renderContent()}

        <footer style={{ marginTop: '3rem', opacity: 0.4, textAlign: 'center', paddingBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.65rem' }}>FECD PREMIUM GTD SYSTEM &copy; 2026</p>
        </footer>
      </main>
    </div>
  );
}
