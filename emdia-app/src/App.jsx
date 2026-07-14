import { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";

/* ============================================================
   Camada de dados — Supabase (nuvem, multiusuário)
   Cada trainer só enxerga os próprios dados (Row Level Security).
   ============================================================ */

/* converte snake_case do banco -> camelCase do app */
const fromDbClient = (r) => ({
  id: r.id, nome: r.nome, tipo: r.tipo, plano: r.plano, ciclo: r.ciclo,
  cobrancaAuto: r.cobranca_auto, valor: r.valor ? Number(r.valor) : undefined,
  diaVenc: r.dia_venc, valorSessao: r.valor_sessao ? Number(r.valor_sessao) : undefined,
  saldo: r.saldo, projetoNome: r.projeto_nome,
  projetoValor: r.projeto_valor ? Number(r.projeto_valor) : undefined,
  whatsapp: r.whatsapp, ativo: r.ativo,
});
const toDbClient = (c, userId) => ({
  user_id: userId, nome: c.nome, tipo: c.tipo, plano: c.plano, ciclo: c.ciclo ?? 1,
  cobranca_auto: !!c.cobrancaAuto, valor: c.valor ?? null, dia_venc: c.diaVenc ?? null,
  valor_sessao: c.valorSessao ?? null, saldo: c.saldo ?? 0,
  projeto_nome: c.projetoNome ?? null, projeto_valor: c.projetoValor ?? null,
  whatsapp: c.whatsapp ?? null, ativo: c.ativo ?? true,
});
const fromDbPayment = (r) => ({
  id: r.id, clientId: r.client_id, valor: Number(r.valor), data: r.data,
  tipo: r.tipo, ref: r.ref, meses: r.meses, creditos: r.creditos,
});
const fromDbSession = (r) => ({ id: r.id, clientId: r.client_id, data: r.data, tipo: r.tipo });

/* ============================================================
   EmDia v2 — Gestão de pagamentos e sessões para personal trainers
   Planos: mensalista · créditos · projeto | Duplas | PIX copia-e-cola
   Camada de dados isolada: troque por Supabase depois sem mexer na UI.
   ============================================================ */

const T = {
  bg: "#F1F4F2", card: "#FFFFFF", ink: "#14201C", inkSoft: "#5B6B64",
  line: "#E2E8E4", brand: "#0F4D34", brandSoft: "#E3F0E9",
  late: "#B3261E", lateSoft: "#FBEAE8", warn: "#8A5A00", warnSoft: "#F7EDD8",
  blue: "#1E4E79", blueSoft: "#E3EDF6",
};

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Inter:wght@400;500;600;700&display=swap');
  *{-webkit-tap-highlight-color:transparent}
  .num{font-family:'Archivo',sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
  .disp{font-family:'Archivo',sans-serif;letter-spacing:-0.01em}
  body{font-family:'Inter',sans-serif}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/* ---------- datas ---------- */
const today = new Date();
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const ym = ymOf(today);
const ymLabel = (k) => {
  const [y, m] = k.split("-");
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};
const nextMonths = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ymOf(new Date(today.getFullYear(), today.getMonth() + i, 1)));
  return out;
};
const addMonth = (k, n) => {
  const [y, m] = k.split("-").map(Number);
  const d2 = new Date(y, m - 1 + n, 1);
  return ymOf(d2);
};
const CICLOS = { 1: "Mensal", 3: "Trimestral", 6: "Semestral", 12: "Anual" };
const cicloRange = (start, meses) =>
  meses === 1 ? ymLabel(start) : `${ymLabel(start)} – ${ymLabel(addMonth(start, meses - 1))}`;
const fmtData = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const mesLabel = today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

/* ---------- PIX (BR Code / EMV, padrão Banco Central) ---------- */
const emv = (id, v) => id + String(v.length).padStart(2, "0") + v;
const crc16 = (s) => {
  let crc = 0xffff;
  for (const ch of s) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};
const sanit = (s, max) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").toUpperCase().slice(0, max);
function pixPayload({ chave, nome, cidade }, valor) {
  const acc = emv("26", emv("00", "br.gov.bcb.pix") + emv("01", chave));
  let p =
    emv("00", "01") + acc + emv("52", "0000") + emv("53", "986") +
    (valor ? emv("54", valor.toFixed(2)) : "") +
    emv("58", "BR") + emv("59", sanit(nome || "TREINADOR", 25)) +
    emv("60", sanit(cidade || "SAO PAULO", 15)) + emv("62", emv("05", "***")) + "6304";
  return p + crc16(p);
}
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}

/* ---------- status ---------- */
function coveredMonths(c, payments) {
  const s = new Set();
  payments
    .filter((p) => p.clientId === c.id && p.tipo === "mensalidade")
    .forEach((p) => {
      const n = p.meses || 1;
      for (let i = 0; i < n; i++) s.add(addMonth(p.ref, i));
    });
  return s;
}
function statusOf(c, payments) {
  if (c.plano === "mensal") {
    if (coveredMonths(c, payments).has(ym)) return { kind: "pago", label: "Pago", bg: T.brandSoft, fg: T.brand };
    const dd = today.getDate();
    if (dd > c.diaVenc) return { kind: "atrasado", dias: dd - c.diaVenc, label: `Atrasado ${dd - c.diaVenc}d`, bg: T.lateSoft, fg: T.late };
    const falta = c.diaVenc - dd;
    return { kind: "aberto", dias: falta, label: falta === 0 ? "Vence hoje" : `Vence em ${falta}d`, bg: T.warnSoft, fg: T.warn };
  }
  if (c.plano === "creditos") {
    const saldo = c.saldo ?? 0;
    if (saldo <= 0) return { kind: "sem-saldo", label: "Sem créditos", bg: T.lateSoft, fg: T.late };
    if (saldo <= 2) return { kind: "saldo-baixo", label: `${saldo} créditos`, bg: T.warnSoft, fg: T.warn };
    return { kind: "ok", label: `${saldo} créditos`, bg: T.blueSoft, fg: T.blue };
  }
  return { kind: "projeto", label: c.projetoNome || "Projeto", bg: T.blueSoft, fg: T.blue };
}
const projetoPago = (c, payments) =>
  payments.filter((p) => p.clientId === c.id && p.tipo === "projeto").reduce((s, p) => s + p.valor, 0);

function waCobranca(c, s) {
  const nome = c.nome.split(" ")[0];
  let corpo;
  if (c.plano === "mensal") {
    const ciclo = c.ciclo || 1;
    corpo = ciclo === 1
      ? `da mensalidade do treino (${brl(c.valor)}), que venceu dia ${c.diaVenc}`
      : `da renovação do seu plano ${CICLOS[ciclo].toLowerCase()} (${brl(c.valor)}), que venceu dia ${c.diaVenc}`;
  }
  else if (c.plano === "creditos") corpo = `da renovação do seu pacote de sessões — seu saldo está acabando`;
  else corpo = `do projeto "${c.projetoNome}"`;
  const msg = `Oi ${nome}! Tudo bem? 😊 Passando pra lembrar ${corpo}. Já te mando o PIX aqui! 💪`;
  return `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(msg)}`;
}

/* ============================================================ APP */
/* ---------- dados de demonstração (modo demo, sem login) ---------- */
const dDemo = (off) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + off).toISOString();
const demoClients = [
  { id: "d1", nome: "Ana Beatriz", tipo: "individual", plano: "mensal", ciclo: 1, valor: 450, diaVenc: 5, whatsapp: "5511999990001", ativo: true },
  { id: "d2", nome: "Carlos Mendes", tipo: "individual", plano: "mensal", ciclo: 1, valor: 380, diaVenc: Math.min(28, today.getDate() + 5), whatsapp: "5511999990002", ativo: true },
  { id: "d3", nome: "Fernanda Lima", tipo: "individual", plano: "creditos", valorSessao: 90, saldo: 2, whatsapp: "5511999990003", ativo: true },
  { id: "d4", nome: "João Pedro", tipo: "individual", plano: "creditos", valorSessao: 90, saldo: 8, whatsapp: "5511999990004", ativo: true },
  { id: "d5", nome: "Mariana Costa", tipo: "individual", plano: "projeto", projetoNome: "Prep. maratona", projetoValor: 3000, whatsapp: "5511999990005", ativo: true },
  { id: "d6", nome: "Paula & Renato", tipo: "dupla", plano: "mensal", ciclo: 1, valor: 700, diaVenc: today.getDate(), whatsapp: "5511999990006", ativo: true },
  { id: "d7", nome: "Diego Martins", tipo: "individual", plano: "mensal", ciclo: 6, valor: 2400, diaVenc: 10, cobrancaAuto: true, whatsapp: "5511999990007", ativo: true },
];
const demoPayments = [
  { id: "p1", clientId: "d1", valor: 450, data: dDemo(-3), tipo: "mensalidade", ref: ym, meses: 1 },
  { id: "p2", clientId: "d4", valor: 900, data: dDemo(-6), tipo: "pacote", creditos: 10 },
  { id: "p3", clientId: "d5", valor: 1500, data: dDemo(-12), tipo: "projeto" },
  { id: "p4", clientId: "d7", valor: 2400, data: dDemo(-20), tipo: "mensalidade", ref: ymOf(new Date(today.getFullYear(), today.getMonth() - 1, 1)), meses: 6 },
];
const demoSessions = [
  { id: "s1", clientId: "d4", data: dDemo(-2), tipo: "plano" },
  { id: "s2", clientId: "d3", data: dDemo(-1), tipo: "plano" },
  { id: "s3", clientId: "d2", data: dDemo(-4), tipo: "experimental" },
];
const demoCfg = { chave: "personal@exemplo.com", nome: "Personal Demo", cidade: "Sao Paulo", descontoAntecipado: 10, linkCartao: "" };

const isDemo = () =>
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("demo") || window.location.hash === "#demo");

/* ---------- porteiro: mostra login se não estiver autenticado ---------- */
export default function Root() {
  const [session, setSession] = useState(undefined);
  const [demo, setDemo] = useState(isDemo());

  useEffect(() => {
    if (demo) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [demo]);

  if (demo) return <App demo onSair={() => { window.history.replaceState({}, "", "/"); setDemo(false); }} />;

  if (session === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <p className="text-sm font-semibold" style={{ color: T.inkSoft }}>Carregando…</p>
      </div>
    );
  if (!session) return <Auth />;
  return <App user={session.user} />;
}

function App({ user, demo, onSair }) {
  const [clients, setClients] = useState(demo ? demoClients : []);
  const [payments, setPayments] = useState(demo ? demoPayments : []);
  const [sessions, setSessions] = useState(demo ? demoSessions : []);
  const [pixCfg, setPixCfg] = useState(demo ? demoCfg : { chave: "", nome: "", cidade: "", descontoAntecipado: 10, linkCartao: "" });
  const [remindersSent, setRemindersSent] = useState({});
  const [carregando, setCarregando] = useState(!demo);

  /* ---- carrega tudo do banco (não roda no modo demo) ---- */
  useEffect(() => {
    if (demo || !user) return;
    (async () => {
      const [c, p, s, cfg] = await Promise.all([
        supabase.from("clients").select("*").order("nome"),
        supabase.from("payments").select("*"),
        supabase.from("sessions").select("*"),
        supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
      ]);
      if (c.data) setClients(c.data.map(fromDbClient));
      if (p.data) setPayments(p.data.map(fromDbPayment));
      if (s.data) setSessions(s.data.map(fromDbSession));
      if (cfg.data)
        setPixCfg({
          chave: cfg.data.chave || "", nome: cfg.data.nome || "", cidade: cfg.data.cidade || "",
          descontoAntecipado: cfg.data.desconto_antecipado ?? 10, linkCartao: cfg.data.link_cartao || "",
        });
      setCarregando(false);
    })();
  }, [demo, user]);
  const [tab, setTab] = useState("painel");
  const [query, setQuery] = useState("");
  const [histFilter, setHistFilter] = useState("tudo");
  const [sheet, setSheet] = useState(null);   // client detail
  const [modal, setModal] = useState(null);   // {type:'cliente'|'pagamento'|'sessao'|'pix'|'config', ...}
  const [toast, setToast] = useState(null);
  const ping = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const ativos = clients.filter((c) => c.ativo);
  const semAlunos = !carregando && clients.length === 0;

  /* ---- métricas ---- */
  const stats = useMemo(() => {
    const inMonth = (iso) => ymOf(new Date(iso)) === ym;
    const recebido = payments.filter((p) => inMonth(p.data)).reduce((s, p) => s + p.valor, 0);
    const mensalistas = ativos.filter((c) => c.plano === "mensal");
    const previsto = Math.round(mensalistas.reduce((s, c) => s + c.valor / (c.ciclo || 1), 0));
    const mensalRec = Math.round(
      mensalistas
        .filter((c) => coveredMonths(c, payments).has(ym))
        .reduce((s, c) => s + c.valor / (c.ciclo || 1), 0)
    );
    const sessoesMes = sessions.filter((s) => inMonth(s.data)).length;
    return { recebido, previsto, pct: previsto ? Math.min(100, Math.round((mensalRec / previsto) * 100)) : 0, sessoesMes };
  }, [ativos, payments, sessions]);

  const alertas = useMemo(() => {
    const out = [];
    ativos.forEach((c) => {
      const s = statusOf(c, payments);
      if (s.kind === "atrasado") out.push({ c, s, prio: 0 });
      else if (s.kind === "sem-saldo") out.push({ c, s, prio: 1 });
      else if (s.kind === "saldo-baixo") out.push({ c, s, prio: 2 });
      else if (s.kind === "aberto" && s.dias <= 3) out.push({ c, s, prio: 3 });
    });
    return out.sort((a, b) => a.prio - b.prio);
  }, [ativos, payments]);

  /* ---- fila de lembretes: 5 dias antes, 1 dia antes e no dia ---- */
  const lembretes = useMemo(() => {
    const out = [];
    ativos.forEach((c) => {
      if (c.plano !== "mensal" || c.cobrancaAuto) return;
      if (coveredMonths(c, payments).has(ym)) return;
      const falta = c.diaVenc - today.getDate();
      if (![5, 1, 0].includes(falta)) return;
      out.push({ c, falta, key: `${c.id}-${ym}-${falta}` });
    });
    return out.sort((a, b) => a.falta - b.falta);
  }, [ativos, payments]);

  const waLembrete = (c, falta) => {
    const nome = c.nome.split(" ")[0];
    const ciclo = c.ciclo || 1;
    const oQue = ciclo === 1 ? `sua mensalidade (${brl(c.valor)})` : `a renovação do seu plano ${CICLOS[ciclo].toLowerCase()} (${brl(c.valor)})`;
    const desc = Number(pixCfg.descontoAntecipado) || 0;
    const comDesc = Math.round(c.valor * (1 - desc / 100));
    let msg;
    if (falta === 5) {
      const valorCobrar = desc > 0 ? comDesc : c.valor;
      msg = `Oi ${nome}! Tudo bem? 😊 ${oQue.charAt(0).toUpperCase() + oQue.slice(1)} vence dia ${c.diaVenc}.` +
        (desc > 0 ? ` Antecipando o pagamento você ganha ${desc}% de desconto e paga só ${brl(comDesc)}! 💪` : " 💪") +
        `\n\nPIX copia-e-cola${desc > 0 ? " (já com o desconto)" : ""}:\n${pixPayload(pixCfg, valorCobrar)}`;
    } else if (falta === 1) {
      msg = `Oi ${nome}! Lembrete rápido: ${oQue} vence amanhã, dia ${c.diaVenc}.` +
        `\n\nPIX copia-e-cola:\n${pixPayload(pixCfg, c.valor)}`;
    } else {
      msg = `Oi ${nome}! ${oQue.charAt(0).toUpperCase() + oQue.slice(1)} vence hoje. Segue o PIX pra facilitar! 💪` +
        `\n\nPIX copia-e-cola:\n${pixPayload(pixCfg, c.valor)}`;
    }
    if (pixCfg.linkCartao) msg += `\n\nSe preferir pagar no cartão: ${pixCfg.linkCartao}`;
    return `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(msg)}`;
  };

  /* ---- ações (gravam no banco; no modo demo, só em memória) ---- */
  const addPayment = async (p) => {
    if (demo) {
      setPayments((ps) => [...ps, { ...p, id: `p${Date.now()}${Math.random()}` }]);
      return;
    }
    const { data, error } = await supabase.from("payments").insert({
      user_id: user.id, client_id: p.clientId, valor: p.valor, data: p.data,
      tipo: p.tipo, ref: p.ref ?? null, meses: p.meses ?? 1, creditos: p.creditos ?? null,
    }).select().single();
    if (error) { ping("Erro ao salvar pagamento"); return; }
    setPayments((ps) => [...ps, fromDbPayment(data)]);
  };

  const registrarSessao = async (c, tipo, valorAvulsa) => {
    setModal(null);
    const agora = new Date().toISOString();

    if (demo) {
      setSessions((ss) => [...ss, { id: `s${Date.now()}`, clientId: c.id, data: agora, tipo }]);
    } else {
      const { data, error } = await supabase.from("sessions")
        .insert({ user_id: user.id, client_id: c.id, data: agora, tipo }).select().single();
      if (error) { ping("Erro ao registrar sessão"); return; }
      setSessions((ss) => [...ss, fromDbSession(data)]);
    }

    if (tipo === "plano" && c.plano === "creditos") {
      const novo = (c.saldo ?? 0) - 1;
      if (!demo) await supabase.from("clients").update({ saldo: novo }).eq("id", c.id);
      setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, saldo: novo } : x)));
      ping(`Sessão registrada · saldo: ${novo}`);
    } else if (tipo === "avulsa") {
      await addPayment({ clientId: c.id, valor: valorAvulsa, data: agora, tipo: "avulsa" });
      ping(`Sessão avulsa registrada · ${brl(valorAvulsa)}`);
    } else ping("Sessão experimental registrada");
  };

  const saveClient = async (dados, editing) => {
    setModal(null); setSheet(null);
    if (editing) {
      if (!demo) {
        const { error } = await supabase.from("clients")
          .update(toDbClient({ ...editing, ...dados }, user.id)).eq("id", editing.id);
        if (error) { ping("Erro ao salvar"); return; }
      }
      setClients((cs) => cs.map((c) => (c.id === editing.id ? { ...c, ...dados } : c)));
      ping("Aluno atualizado");
    } else {
      if (demo) {
        setClients((cs) => [...cs, { ...dados, id: `d${Date.now()}`, ativo: true, saldo: 0 }]);
        ping("Aluno adicionado");
        return;
      }
      const { data, error } = await supabase.from("clients")
        .insert(toDbClient({ ...dados, ativo: true, saldo: 0 }, user.id)).select().single();
      if (error) { ping("Erro ao adicionar aluno"); return; }
      setClients((cs) => [...cs, fromDbClient(data)]);
      ping("Aluno adicionado");
    }
  };

  const toggleAtivo = async (c) => {
    setSheet(null);
    if (!demo) await supabase.from("clients").update({ ativo: !c.ativo }).eq("id", c.id);
    setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, ativo: !x.ativo } : x)));
    ping(c.ativo ? "Aluno pausado" : "Aluno reativado");
  };

  const saveCfg = async (novo) => {
    setModal(null);
    if (!demo) {
      const { error } = await supabase.from("settings").upsert({
        user_id: user.id, chave: novo.chave, nome: novo.nome, cidade: novo.cidade,
        desconto_antecipado: novo.descontoAntecipado, link_cartao: novo.linkCartao,
      });
      if (error) { ping("Erro ao salvar"); return; }
    }
    setPixCfg(novo);
    ping("Configurações salvas");
  };

  const clientById = (id) => clients.find((c) => c.id === id);
  const sheetClient = sheet ? clientById(sheet) : null;

  /* ---- histórico unificado ---- */
  const feed = useMemo(() => {
    const pays = payments.map((p) => ({ ...p, kind: "pagamento", when: p.data }));
    const sess = sessions.map((s) => ({ ...s, kind: "sessao", when: s.data }));
    return [...pays, ...sess]
      .filter((e) => (histFilter === "tudo" ? true : histFilter === "pagamentos" ? e.kind === "pagamento" : e.kind === "sessao"))
      .sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [payments, sessions, histFilter]);

  const feedLabel = (e) => {
    const c = clientById(e.clientId);
    if (e.kind === "pagamento") {
      const t = { mensalidade: `Plano ${e.ref ? cicloRange(e.ref, e.meses || 1) : ""}`, pacote: `Pacote ${e.creditos} créditos`, projeto: "Projeto", avulsa: "Sessão avulsa" }[e.tipo];
      return { titulo: c?.nome || "—", sub: t, valor: `+ ${brl(e.valor)}`, cor: T.brand };
    }
    const t = { plano: "Sessão", experimental: "Aula experimental", avulsa: "Sessão avulsa" }[e.tipo];
    return { titulo: c?.nome || "—", sub: t, valor: "", cor: T.inkSoft };
  };

  const cardStyle = { background: T.card, border: `1px solid ${T.line}` };

  return (
    <div className="min-h-screen flex justify-center" style={{ background: T.bg }}>
      <style>{FONT}</style>
      <div className="w-full max-w-md flex flex-col min-h-screen relative">
        {demo && (
          <div className="sticky top-0 z-10 px-4 py-2.5 flex items-center justify-between gap-3"
            style={{ background: "#14201C" }}>
            <p className="text-xs font-semibold text-white leading-tight">
              Modo demonstração · dados fictícios
              <span className="block font-normal" style={{ color: "#9CC5B0" }}>
                Mexa à vontade — nada é salvo.
              </span>
            </p>
            <button onClick={onSair}
              className="text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap"
              style={{ background: "#7FD4A8", color: "#0B3A27" }}>
              Criar minha conta
            </button>
          </div>
        )}

        <main className="flex-1 pb-28">

          {/* ================= PAINEL ================= */}
          {tab === "painel" && (
            <>
              <header className="px-5 pt-6 pb-5 rounded-b-3xl" style={{ background: T.brand }}>
                <div className="flex items-center justify-between">
                  <span className="disp font-black text-lg" style={{ color: "#CFE8DA" }}>EmDia</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium capitalize" style={{ color: "#9CC5B0" }}>{mesLabel}</span>
                    <button onClick={() => setModal({ type: "config" })} aria-label="Configurar PIX"
                      className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)", color: "#CFE8DA" }}>
                      PIX ⚙
                    </button>
                  </div>
                </div>
                <p className="mt-5 text-xs font-semibold uppercase tracking-wide" style={{ color: "#9CC5B0" }}>Recebido no mês</p>
                <span className="num font-black text-4xl text-white">{brl(stats.recebido)}</span>
                <div className="flex items-center gap-1 mt-3" aria-label={`${stats.pct}% das mensalidades recebidas`}>
                  <div className="w-1 h-2 rounded-sm" style={{ background: "#2E4A3D" }} />
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex-1 rounded-sm transition-all duration-500"
                      style={{ height: i < Math.round((stats.pct / 100) * 12) ? 18 : 10, background: i < Math.round((stats.pct / 100) * 12) ? "#7FD4A8" : "rgba(255,255,255,0.18)" }} />
                  ))}
                  <div className="w-1 h-2 rounded-sm" style={{ background: "#2E4A3D" }} />
                </div>
                <div className="flex justify-between mt-2 text-xs" style={{ color: "#9CC5B0" }}>
                  <span>{stats.pct}% das mensalidades ({brl(stats.previsto)} previstos)</span>
                  <span>{stats.sessoesMes} sessões no mês</span>
                </div>
              </header>

              {/* lembretes do dia */}
              {lembretes.length > 0 && (
                <div className="px-5 mt-4">
                  <h2 className="disp font-black text-sm uppercase tracking-wide mb-2" style={{ color: T.inkSoft }}>
                    Lembretes de hoje ({lembretes.length})
                  </h2>
                  <div className="flex flex-col gap-2">
                    {lembretes.map(({ c, falta, key }) => {
                      const sent = remindersSent[key];
                      const tag = falta === 5 ? "Vence em 5 dias" : falta === 1 ? "Vence amanhã" : "Vence hoje";
                      return (
                        <div key={key} className="rounded-2xl p-3.5" style={{ background: T.card, border: `1px solid ${falta === 0 ? "#EFC7C3" : T.line}` }}>
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate" style={{ color: T.ink }}>{c.nome}</p>
                              <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>
                                {brl(c.valor)} · {tag}
                                {falta === 5 && Number(pixCfg.descontoAntecipado) > 0 && ` · oferta de ${pixCfg.descontoAntecipado}% antecipando`}
                              </p>
                            </div>
                            {sent ? (
                              <span className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: T.brandSoft, color: T.brand }}>
                                Enviado ✓
                              </span>
                            ) : (
                              <a href={waLembrete(c, falta)} target="_blank" rel="noreferrer"
                                onClick={() => setRemindersSent((r) => ({ ...r, [key]: true }))}
                                className="text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap"
                                style={{ background: "#E7F6EC", color: "#1B7A3D" }}>
                                Enviar lembrete
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* alertas */}
              <div className="px-5 mt-4">
                <h2 className="disp font-black text-sm uppercase tracking-wide mb-2" style={{ color: T.inkSoft }}>
                  Alertas {alertas.length > 0 && `(${alertas.length})`}
                </h2>
                {alertas.length === 0 && (
                  <div className="rounded-2xl p-4 text-sm font-semibold text-center" style={{ background: T.brandSoft, color: T.brand }}>
                    Tudo em dia ✓
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {alertas.map(({ c, s }) => (
                    <button key={c.id} onClick={() => setSheet(c.id)}
                      className="rounded-2xl p-3.5 flex items-center justify-between text-left" style={cardStyle}>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: T.ink }}>{c.nome}</p>
                        <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>
                          {c.plano === "mensal" ? `${brl(c.valor)} · dia ${c.diaVenc}` : c.plano === "creditos" ? "Plano de créditos" : c.projetoNome}
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* alunos */}
              <div className="px-5 mt-5">
                <h2 className="disp font-black text-sm uppercase tracking-wide mb-2" style={{ color: T.inkSoft }}>Alunos ativos</h2>
                {carregando && <p className="text-sm text-center py-6" style={{ color: T.inkSoft }}>Carregando…</p>}
                {semAlunos && (
                  <div className="rounded-2xl p-5 text-center" style={{ background: T.card, border: `1px dashed ${T.line}` }}>
                    <p className="font-semibold text-sm" style={{ color: T.ink }}>Comece cadastrando seu primeiro aluno</p>
                    <p className="text-xs mt-1 mb-4" style={{ color: T.inkSoft }}>
                      Leva 30 segundos. Depois é só um toque para cobrar com PIX pronto.
                    </p>
                    <button onClick={() => setModal({ type: "cliente" })}
                      className="px-5 py-2.5 rounded-xl font-bold text-sm text-white" style={{ background: T.brand }}>
                      + Adicionar aluno
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {ativos.map((c) => {
                    const s = statusOf(c, payments);
                    return (
                      <button key={c.id} onClick={() => setSheet(c.id)}
                        className="rounded-2xl p-4 flex items-center justify-between text-left" style={cardStyle}>
                        <div className="min-w-0">
                          <p className="font-semibold truncate" style={{ color: T.ink }}>
                            {c.nome} {c.tipo === "dupla" && <span className="text-xs font-bold px-1.5 py-0.5 rounded ml-1" style={{ background: T.blueSoft, color: T.blue }}>DUPLA</span>}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>
                            {c.plano === "mensal" && `${CICLOS[c.ciclo || 1]} · ${brl(c.valor)} · dia ${c.diaVenc}${c.cobrancaAuto ? " · cartão recorrente" : ""}`}
                            {c.plano === "creditos" && `Créditos · ${brl(c.valorSessao)}/sessão`}
                            {c.plano === "projeto" && `Projeto · ${brl(projetoPago(c, payments))} de ${brl(c.projetoValor)}`}
                          </p>
                        </div>
                        <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ================= ALUNOS ================= */}
          {tab === "alunos" && (
            <>
              <header className="px-5 pt-6 pb-4">
                <h1 className="disp font-black text-2xl" style={{ color: T.ink }}>Alunos</h1>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar aluno…"
                  className="mt-3 w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={{ ...cardStyle, color: T.ink }} />
              </header>
              <div className="px-5 flex flex-col gap-2">
                {clients.filter((c) => c.nome.toLowerCase().includes(query.toLowerCase()))
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((c) => (
                    <button key={c.id} onClick={() => setSheet(c.id)}
                      className="text-left rounded-2xl p-4 flex items-center justify-between"
                      style={{ ...cardStyle, opacity: c.ativo ? 1 : 0.5 }}>
                      <div>
                        <p className="font-semibold" style={{ color: T.ink }}>
                          {c.nome} {!c.ativo && <span className="text-xs font-normal">(inativo)</span>}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>
                          {{ mensal: "Mensalista", creditos: "Créditos", projeto: "Projeto" }[c.plano]}
                          {c.tipo === "dupla" && " · dupla"}
                        </p>
                      </div>
                      <span className="text-lg" style={{ color: T.inkSoft }}>›</span>
                    </button>
                  ))}
              </div>
            </>
          )}

          {/* ================= HISTÓRICO ================= */}
          {tab === "historico" && (
            <>
              <header className="px-5 pt-6 pb-3">
                <h1 className="disp font-black text-2xl" style={{ color: T.ink }}>Histórico</h1>
              </header>
              <div className="flex gap-2 px-5 mb-3">
                {[["tudo", "Tudo"], ["pagamentos", "Pagamentos"], ["sessoes", "Sessões"]].map(([k, l]) => (
                  <button key={k} onClick={() => setHistFilter(k)}
                    className="text-sm font-semibold px-3.5 py-1.5 rounded-full"
                    style={histFilter === k ? { background: T.ink, color: "#fff" } : { ...cardStyle, color: T.inkSoft }}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="px-5 flex flex-col gap-2">
                {feed.length === 0 && <p className="text-sm text-center py-10" style={{ color: T.inkSoft }}>Nada registrado ainda.</p>}
                {feed.map((e) => {
                  const f = feedLabel(e);
                  return (
                    <div key={`${e.kind}-${e.id}`} className="rounded-2xl px-4 py-3 flex items-center justify-between" style={cardStyle}>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: T.ink }}>{f.titulo}</p>
                        <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>{f.sub} · {fmtData(e.when)}</p>
                      </div>
                      <span className="num font-bold text-sm" style={{ color: f.cor }}>{f.valor}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {/* ================= NAV ================= */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md flex items-center justify-around px-4 py-3"
          style={{ background: T.card, borderTop: `1px solid ${T.line}` }}>
          <button onClick={() => setTab("painel")} className="text-sm font-bold py-1 w-20" style={{ color: tab === "painel" ? T.brand : T.inkSoft }}>Painel</button>
          <button onClick={() => setTab("alunos")} className="text-sm font-bold py-1 w-20" style={{ color: tab === "alunos" ? T.brand : T.inkSoft }}>Alunos</button>
          <button onClick={() => setModal({ type: "cliente" })} aria-label="Adicionar aluno"
            className="disp w-14 h-14 -mt-8 rounded-full text-2xl font-black text-white shadow-lg" style={{ background: T.brand }}>+</button>
          <button onClick={() => setTab("historico")} className="text-sm font-bold py-1 w-20" style={{ color: tab === "historico" ? T.brand : T.inkSoft }}>Histórico</button>
          <button onClick={() => setModal({ type: "config" })} className="text-sm font-bold py-1 w-20" style={{ color: T.inkSoft }}>PIX</button>
        </nav>

        {/* ================= FICHA DO ALUNO ================= */}
        {sheetClient && !modal && (
          <Sheet onClose={() => setSheet(null)}>
            <ClientSheet
              c={sheetClient} payments={payments} sessions={sessions}
              onPagamento={() => setModal({ type: "pagamento", client: sheetClient })}
              onSessao={() => setModal({ type: "sessao", client: sheetClient })}
              onPix={() => setModal({ type: "pix", client: sheetClient })}
              onEditar={() => setModal({ type: "cliente", client: sheetClient })}
              onToggleAtivo={() => toggleAtivo(sheetClient)}
            />
          </Sheet>
        )}

        {/* ================= MODAIS ================= */}
        {modal?.type === "cliente" && (
          <Sheet onClose={() => setModal(null)}>
            <ClientForm initial={modal.client} onSave={(data) => saveClient(data, modal.client)} onCancel={() => setModal(null)} />
          </Sheet>
        )}
        {modal?.type === "pagamento" && (
          <Sheet onClose={() => setModal(null)}>
            <PaymentForm c={modal.client} payments={payments}
              onSave={async (list, msg) => {
                const alvo = modal.client;
                setModal(null);
                for (const p of list) await addPayment(p);
                if (alvo.plano === "creditos") {
                  const cred = list.reduce((s, p) => s + (p.creditos || 0), 0);
                  if (cred) {
                    const novo = (alvo.saldo ?? 0) + cred;
                    await supabase.from("clients").update({ saldo: novo }).eq("id", alvo.id);
                    setClients((cs) => cs.map((x) => (x.id === alvo.id ? { ...x, saldo: novo } : x)));
                  }
                }
                ping(msg);
              }}
              onCancel={() => setModal(null)} />
          </Sheet>
        )}
        {modal?.type === "sessao" && (
          <Sheet onClose={() => setModal(null)}>
            <SessionForm c={modal.client} onSave={registrarSessao} onCancel={() => setModal(null)} />
          </Sheet>
        )}
        {modal?.type === "pix" && (
          <Sheet onClose={() => setModal(null)}>
            <PixForm c={modal.client} cfg={pixCfg} onCopied={() => ping("PIX copiado ✓")} onClose={() => setModal(null)} />
          </Sheet>
        )}
        {modal?.type === "config" && (
          <Sheet onClose={() => setModal(null)}>
            <PixConfig cfg={pixCfg} email={demo ? "Modo demonstração" : user.email} onSave={saveCfg} onCancel={() => setModal(null)}
              onLogout={() => (demo ? onSair() : supabase.auth.signOut())} demo={demo} />
          </Sheet>
        )}

        {toast && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 text-sm font-semibold text-white px-4 py-2 rounded-full shadow-lg z-30"
            style={{ background: T.ink }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ COMPONENTES */
function Sheet({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center" style={{ background: "rgba(20,32,28,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-t-3xl p-5 pb-8 max-h-[88vh] overflow-y-auto" style={{ background: T.card }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: T.line }} />
        {children}
      </div>
    </div>
  );
}

const fieldStyle = { background: T.bg, border: `1px solid ${T.line}`, color: T.ink };
const Label = ({ children }) => <label className="block text-xs font-semibold mb-1" style={{ color: T.inkSoft }}>{children}</label>;
const Btn = ({ children, primary, disabled, ...p }) => (
  <button disabled={disabled} {...p}
    className={`flex-1 py-3 rounded-xl font-bold text-sm ${primary ? "text-white" : ""}`}
    style={primary ? { background: disabled ? "#A9BDB2" : T.brand } : { background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
    {children}
  </button>
);

/* ---- ficha do aluno ---- */
function ClientSheet({ c, payments, sessions, onPagamento, onSessao, onPix, onEditar, onToggleAtivo }) {
  const s = statusOf(c, payments);
  const hist = [
    ...payments.filter((p) => p.clientId === c.id).map((p) => ({ ...p, kind: "pag", when: p.data })),
    ...sessions.filter((x) => x.clientId === c.id).map((x) => ({ ...x, kind: "ses", when: x.data })),
  ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 6);

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="disp font-black text-xl" style={{ color: T.ink }}>{c.nome}</h2>
          <p className="text-xs mt-0.5" style={{ color: T.inkSoft }}>
            {c.plano === "mensal"
              ? `${CICLOS[c.ciclo || 1]} · ${brl(c.valor)} · vence dia ${c.diaVenc}${c.cobrancaAuto ? " · cartão recorrente" : ""}`
              : c.plano === "creditos"
              ? `Créditos · ${brl(c.valorSessao)}/sessão`
              : `${c.projetoNome} · ${brl(c.projetoValor)}`}
            {c.tipo === "dupla" && " · dupla"}
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
      </div>

      {c.plano === "projeto" && (
        <div className="mt-3 rounded-xl p-3" style={{ background: T.bg }}>
          <div className="flex justify-between text-xs font-semibold" style={{ color: T.inkSoft }}>
            <span>Recebido do projeto</span>
            <span className="num" style={{ color: T.ink }}>{brl(projetoPago(c, payments))} / {brl(c.projetoValor)}</span>
          </div>
          <div className="h-2 rounded-full mt-2" style={{ background: T.line }}>
            <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (projetoPago(c, payments) / c.projetoValor) * 100)}%`, background: T.brand }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-4">
        <Btn primary onClick={onPagamento}>Lançar pagamento</Btn>
        <Btn primary onClick={onSessao}>Registrar sessão</Btn>
        <Btn onClick={onPix}>Gerar PIX</Btn>
        <a href={waCobranca(c, s)} target="_blank" rel="noreferrer"
          className="flex-1 py-3 rounded-xl font-bold text-sm text-center" style={{ background: "#E7F6EC", color: "#1B7A3D" }}>
          Cobrar no WhatsApp
        </a>
      </div>

      <h3 className="disp font-black text-xs uppercase tracking-wide mt-5 mb-2" style={{ color: T.inkSoft }}>Últimos lançamentos</h3>
      <div className="flex flex-col gap-1.5">
        {hist.length === 0 && <p className="text-xs" style={{ color: T.inkSoft }}>Nenhum lançamento ainda.</p>}
        {hist.map((e) => (
          <div key={`${e.kind}${e.id}`} className="flex justify-between text-xs py-1.5 px-1" style={{ borderBottom: `1px solid ${T.line}` }}>
            <span style={{ color: T.ink }}>
              {e.kind === "pag"
                ? { mensalidade: `Plano ${e.ref ? cicloRange(e.ref, e.meses || 1) : ""}`, pacote: `Pacote ${e.creditos} créditos`, projeto: "Pagamento projeto", avulsa: "Sessão avulsa" }[e.tipo]
                : { plano: "Sessão", experimental: "Aula experimental", avulsa: "Sessão avulsa" }[e.tipo]}
            </span>
            <span className="num font-semibold" style={{ color: e.kind === "pag" ? T.brand : T.inkSoft }}>
              {e.kind === "pag" ? `+ ${brl(e.valor)}` : fmtData(e.when)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-4">
        <Btn onClick={onEditar}>Editar</Btn>
        <Btn onClick={onToggleAtivo}>{c.ativo ? "Pausar" : "Reativar"}</Btn>
      </div>
    </>
  );
}

/* ---- formulário de aluno ---- */
function ClientForm({ initial, onSave, onCancel }) {
  const [nome, setNome] = useState(initial?.nome || "");
  const [tipo, setTipo] = useState(initial?.tipo || "individual");
  const [plano, setPlano] = useState(initial?.plano || "mensal");
  const [ciclo, setCiclo] = useState(initial?.ciclo || 1);
  const [cobrancaAuto, setCobrancaAuto] = useState(initial?.cobrancaAuto || false);
  const [valor, setValor] = useState(initial?.valor || "");
  const [diaVenc, setDiaVenc] = useState(initial?.diaVenc || "");
  const [valorSessao, setValorSessao] = useState(initial?.valorSessao || "");
  const [projetoNome, setProjetoNome] = useState(initial?.projetoNome || "");
  const [projetoValor, setProjetoValor] = useState(initial?.projetoValor || "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp || "");

  const ok = nome.trim() && (
    (plano === "mensal" && Number(valor) > 0 && Number(diaVenc) >= 1 && Number(diaVenc) <= 31) ||
    (plano === "creditos" && Number(valorSessao) > 0) ||
    (plano === "projeto" && projetoNome.trim() && Number(projetoValor) > 0)
  );

  const Seg = ({ options, value, onChange }) => (
    <div className="flex gap-2 mb-3">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className="flex-1 text-sm font-semibold py-2 rounded-xl"
          style={value === k ? { background: T.ink, color: "#fff" } : { background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <h2 className="disp font-black text-xl mb-4" style={{ color: T.ink }}>{initial ? "Editar aluno" : "Novo aluno"}</h2>
      <Label>Nome {tipo === "dupla" && "(ex: Paula & Renato)"}</Label>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do aluno"
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} />

      <Label>Tipo</Label>
      <Seg options={[["individual", "Individual"], ["dupla", "Dupla"]]} value={tipo} onChange={setTipo} />

      <Label>Plano</Label>
      <Seg options={[["mensal", "Mensalista"], ["creditos", "Créditos"], ["projeto", "Projeto"]]} value={plano} onChange={setPlano} />

      {plano === "mensal" && (
        <>
          <Label>Ciclo do plano</Label>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {Object.entries(CICLOS).map(([k, l]) => (
              <button key={k} onClick={() => setCiclo(Number(k))}
                className="text-xs font-semibold py-2 rounded-xl"
                style={ciclo === Number(k) ? { background: T.ink, color: "#fff" } : { background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <Label>{ciclo === 1 ? "Valor mensal (R$)" : `Valor do ${CICLOS[ciclo].toLowerCase()} (R$)`}</Label>
              <input type="number" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={ciclo === 1 ? "450" : String(450 * ciclo)}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
            </div>
            <div className="flex-1">
              <Label>Dia do vencimento</Label>
              <input type="number" inputMode="numeric" min="1" max="31" value={diaVenc} onChange={(e) => setDiaVenc(e.target.value)} placeholder="5"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
            </div>
          </div>
          <button onClick={() => setCobrancaAuto(!cobrancaAuto)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl mb-3 text-sm font-semibold"
            style={{ background: cobrancaAuto ? T.blueSoft : T.bg, color: cobrancaAuto ? T.blue : T.inkSoft, border: `1px solid ${cobrancaAuto ? "#BFD3E6" : T.line}` }}>
            <span>Cartão recorrente (assinatura)</span>
            <span>{cobrancaAuto ? "Ativo ✓" : "Inativo"}</span>
          </button>
          {cobrancaAuto && (
            <p className="text-xs mb-3 -mt-1" style={{ color: T.inkSoft }}>
              A cobrança acontece automática no cartão — este aluno sai da fila de lembretes. Lance o pagamento quando cair.
            </p>
          )}
        </>
      )}
      {plano === "creditos" && (
        <div className="mb-3">
          <Label>Valor por sessão (R$)</Label>
          <input type="number" inputMode="numeric" value={valorSessao} onChange={(e) => setValorSessao(e.target.value)} placeholder="90"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
          <p className="text-xs mt-1" style={{ color: T.inkSoft }}>Os créditos entram quando você lançar a venda de um pacote.</p>
        </div>
      )}
      {plano === "projeto" && (
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <Label>Nome do projeto</Label>
            <input value={projetoNome} onChange={(e) => setProjetoNome(e.target.value)} placeholder="Prep. maratona"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
          </div>
          <div className="flex-1">
            <Label>Valor total (R$)</Label>
            <input type="number" inputMode="numeric" value={projetoValor} onChange={(e) => setProjetoValor(e.target.value)} placeholder="3000"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
          </div>
        </div>
      )}

      <Label>WhatsApp (com DDI, ex: 5511999990000)</Label>
      <input inputMode="numeric" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ""))} placeholder="5511…"
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-5" style={fieldStyle} />

      <div className="flex gap-2">
        <Btn onClick={onCancel}>Cancelar</Btn>
        <Btn primary disabled={!ok}
          onClick={() => onSave({
            nome: nome.trim(), tipo, plano, whatsapp,
            ciclo: plano === "mensal" ? ciclo : undefined,
            cobrancaAuto: plano === "mensal" ? cobrancaAuto : undefined,
            valor: Number(valor) || undefined, diaVenc: Number(diaVenc) || undefined,
            valorSessao: Number(valorSessao) || undefined,
            projetoNome: projetoNome.trim() || undefined, projetoValor: Number(projetoValor) || undefined,
          })}>
          {initial ? "Salvar" : "Adicionar"}
        </Btn>
      </div>
    </>
  );
}

/* ---- lançar pagamento (com antecipados) ---- */
function PaymentForm({ c, payments, onSave, onCancel }) {
  const [sel, setSel] = useState([]);
  const [qtd, setQtd] = useState("10");
  const [valorPacote, setValorPacote] = useState(c.valorSessao ? String(c.valorSessao * 10) : "");
  const [valorProj, setValorProj] = useState("");

  const toggle = (m) => setSel((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const now = new Date().toISOString();

  return (
    <>
      <h2 className="disp font-black text-xl mb-1" style={{ color: T.ink }}>Lançar pagamento</h2>
      <p className="text-xs mb-4" style={{ color: T.inkSoft }}>{c.nome}</p>

      {c.plano === "mensal" && (() => {
        const ciclo = c.ciclo || 1;
        const covered = new Set(payments.filter((p) => p.clientId === c.id && p.tipo === "mensalidade")
          .flatMap((p) => Array.from({ length: p.meses || 1 }, (_, i) => addMonth(p.ref, i))));
        let start = ym;
        while (covered.has(start)) start = addMonth(start, 1);
        const ciclos = Array.from({ length: 4 }, (_, i) => addMonth(start, i * ciclo));
        return (
          <>
            <Label>
              {ciclo === 1 ? "Meses (marque mais de um para pagamento antecipado)" : `Ciclos ${CICLOS[ciclo].toLowerCase()}s (cada um cobre ${ciclo} meses)`}
            </Label>
            <div className="flex gap-2 flex-wrap mb-4">
              {ciclos.map((m) => (
                <button key={m} onClick={() => toggle(m)}
                  className="text-sm font-semibold px-3.5 py-2 rounded-xl capitalize"
                  style={sel.includes(m) ? { background: T.brand, color: "#fff" } : { background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
                  {cicloRange(m, ciclo)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Btn onClick={onCancel}>Cancelar</Btn>
              <Btn primary disabled={sel.length === 0}
                onClick={() => onSave(
                  sel.map((ref) => ({ clientId: c.id, valor: c.valor, data: now, tipo: "mensalidade", ref, meses: ciclo })),
                  sel.length > 1 ? `${sel.length} ciclos lançados (antecipado) ✓` : ciclo === 1 ? "Mensalidade lançada ✓" : `Plano ${CICLOS[ciclo].toLowerCase()} lançado ✓`
                )}>
                Lançar {sel.length > 0 && brl(c.valor * sel.length)}
              </Btn>
            </div>
          </>
        );
      })()}

      {c.plano === "creditos" && (
        <>
          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <Label>Qtd. de sessões</Label>
              <input type="number" inputMode="numeric" value={qtd} onChange={(e) => { setQtd(e.target.value); if (c.valorSessao) setValorPacote(String((Number(e.target.value) || 0) * c.valorSessao)); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
            </div>
            <div className="flex-1">
              <Label>Valor do pacote (R$)</Label>
              <input type="number" inputMode="numeric" value={valorPacote} onChange={(e) => setValorPacote(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
            </div>
          </div>
          <p className="text-xs mb-4" style={{ color: T.inkSoft }}>Saldo atual: {c.saldo ?? 0} → novo saldo: {(c.saldo ?? 0) + (Number(qtd) || 0)}</p>
          <div className="flex gap-2">
            <Btn onClick={onCancel}>Cancelar</Btn>
            <Btn primary disabled={!(Number(qtd) > 0 && Number(valorPacote) > 0)}
              onClick={() => onSave(
                [{ clientId: c.id, valor: Number(valorPacote), data: now, tipo: "pacote", creditos: Number(qtd) }],
                `Pacote de ${qtd} sessões lançado ✓`
              )}>
              Lançar pacote
            </Btn>
          </div>
        </>
      )}

      {c.plano === "projeto" && (
        <>
          <Label>Valor recebido (R$) — pode ser parcial</Label>
          <input type="number" inputMode="numeric" value={valorProj} onChange={(e) => setValorProj(e.target.value)}
            placeholder={`Restante: ${brl(c.projetoValor - projetoPago(c, payments))}`}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-4" style={fieldStyle} />
          <div className="flex gap-2">
            <Btn onClick={onCancel}>Cancelar</Btn>
            <Btn primary disabled={!(Number(valorProj) > 0)}
              onClick={() => onSave([{ clientId: c.id, valor: Number(valorProj), data: now, tipo: "projeto" }], "Pagamento do projeto lançado ✓")}>
              Lançar
            </Btn>
          </div>
        </>
      )}
    </>
  );
}

/* ---- registrar sessão ---- */
function SessionForm({ c, onSave, onCancel }) {
  const [tipo, setTipo] = useState("plano");
  const [valor, setValor] = useState(c.valorSessao ? String(c.valorSessao) : "");
  const opts = [["plano", "Do plano"], ["experimental", "Experimental"], ["avulsa", "Avulsa"]];

  return (
    <>
      <h2 className="disp font-black text-xl mb-1" style={{ color: T.ink }}>Registrar sessão</h2>
      <p className="text-xs mb-4" style={{ color: T.inkSoft }}>{c.nome} · hoje</p>
      <div className="flex gap-2 mb-3">
        {opts.map(([k, l]) => (
          <button key={k} onClick={() => setTipo(k)}
            className="flex-1 text-sm font-semibold py-2 rounded-xl"
            style={tipo === k ? { background: T.ink, color: "#fff" } : { background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
            {l}
          </button>
        ))}
      </div>

      {tipo === "plano" && c.plano === "creditos" && (
        <p className="text-xs mb-4 font-semibold" style={{ color: (c.saldo ?? 0) <= 0 ? T.late : T.inkSoft }}>
          {(c.saldo ?? 0) <= 0 ? "Aluno sem créditos — venda um pacote ou registre como avulsa." : `Desconta 1 crédito · saldo ficará em ${(c.saldo ?? 0) - 1}`}
        </p>
      )}
      {tipo === "plano" && c.plano !== "creditos" && (
        <p className="text-xs mb-4" style={{ color: T.inkSoft }}>Sessão incluída no plano — nada é cobrado.</p>
      )}
      {tipo === "experimental" && <p className="text-xs mb-4" style={{ color: T.inkSoft }}>Aula experimental gratuita — fica no histórico.</p>}
      {tipo === "avulsa" && (
        <div className="mb-4">
          <Label>Valor da sessão avulsa (R$)</Label>
          <input type="number" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="100"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle} />
          <p className="text-xs mt-1" style={{ color: T.inkSoft }}>Lança a sessão e o recebimento juntos.</p>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onCancel}>Cancelar</Btn>
        <Btn primary disabled={(tipo === "avulsa" && !(Number(valor) > 0)) || (tipo === "plano" && c.plano === "creditos" && (c.saldo ?? 0) <= 0)}
          onClick={() => onSave(c, tipo, Number(valor))}>
          Registrar
        </Btn>
      </div>
    </>
  );
}

/* ---- PIX copia-e-cola ---- */
function PixForm({ c, cfg, onCopied, onClose }) {
  const sugestao = c.plano === "mensal" ? c.valor : c.plano === "creditos" ? (c.valorSessao || 0) * 10 : "";
  const [valor, setValor] = useState(sugestao ? String(sugestao) : "");
  const payload = Number(valor) > 0 ? pixPayload(cfg, Number(valor)) : null;

  const enviarWa = payload
    ? `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(
        `Oi ${c.nome.split(" ")[0]}! Segue o PIX copia-e-cola de ${brl(Number(valor))}:\n\n${payload}` +
        (cfg.linkCartao ? `\n\nSe preferir pagar no cartão: ${cfg.linkCartao}` : "")
      )}`
    : null;

  return (
    <>
      <h2 className="disp font-black text-xl mb-1" style={{ color: T.ink }}>PIX copia-e-cola</h2>
      <p className="text-xs mb-4" style={{ color: T.inkSoft }}>{c.nome} · chave: {cfg.chave}</p>
      <Label>Valor (R$)</Label>
      <input type="number" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} />
      {payload && (
        <div className="rounded-xl p-3 mb-4 break-all text-xs num" style={{ background: T.bg, color: T.inkSoft, border: `1px solid ${T.line}` }}>
          {payload}
        </div>
      )}
      <div className="flex gap-2">
        <Btn onClick={onClose}>Fechar</Btn>
        <Btn primary disabled={!payload} onClick={() => { copyText(payload); onCopied(); }}>Copiar código</Btn>
      </div>
      {enviarWa && (
        <a href={enviarWa} target="_blank" rel="noreferrer"
          className="block mt-2 py-3 rounded-xl font-bold text-sm text-center" style={{ background: "#E7F6EC", color: "#1B7A3D" }}>
          Enviar pelo WhatsApp
        </a>
      )}
    </>
  );
}

/* ---- configuração PIX ---- */
function PixConfig({ cfg, email, onSave, onCancel, onLogout, demo }) {
  const [chave, setChave] = useState(cfg.chave);
  const [nome, setNome] = useState(cfg.nome);
  const [cidade, setCidade] = useState(cfg.cidade);
  const [descontoAntecipado, setDesconto] = useState(String(cfg.descontoAntecipado ?? 0));
  const [linkCartao, setLinkCartao] = useState(cfg.linkCartao || "");
  return (
    <>
      <h2 className="disp font-black text-xl mb-4" style={{ color: T.ink }}>Configurações</h2>
      <Label>Chave PIX (CPF, celular, e-mail ou aleatória)</Label>
      <input value={chave} onChange={(e) => setChave(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} />
      <Label>Seu nome (aparece no app do banco do aluno)</Label>
      <input value={nome} onChange={(e) => setNome(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} />
      <Label>Cidade</Label>
      <input value={cidade} onChange={(e) => setCidade(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} />
      <Label>Desconto por antecipação (%) — vai no lembrete de 5 dias</Label>
      <input type="number" inputMode="numeric" min="0" max="50" value={descontoAntecipado} onChange={(e) => setDesconto(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={fieldStyle} placeholder="0 = sem desconto" />
      <Label>Link de pagamento no cartão (opcional — Mercado Pago, InfinitePay…)</Label>
      <input value={linkCartao} onChange={(e) => setLinkCartao(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-5" style={fieldStyle} placeholder="https://…" />
      <div className="flex gap-2">
        <Btn onClick={onCancel}>Cancelar</Btn>
        <Btn primary disabled={!chave.trim()}
          onClick={() => onSave({ chave: chave.trim(), nome, cidade, descontoAntecipado: Number(descontoAntecipado) || 0, linkCartao: linkCartao.trim() })}>
          Salvar
        </Btn>
      </div>
      <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
        <p className="text-xs mb-2" style={{ color: T.inkSoft }}>Conta: {email}</p>
        <a href="https://emdia-site-8dpe.vercel.app" target="_blank" rel="noopener"
          className="block w-full py-2.5 rounded-xl font-semibold text-sm text-center mb-2"
          style={{ background: T.brandSoft, color: T.brand }}>
          Conheça os planos do EmDia
        </a>
        <button onClick={onLogout}
          className="w-full py-2.5 rounded-xl font-semibold text-sm"
          style={demo
            ? { background: T.brand, color: "#fff", border: "none" }
            : { background: "transparent", color: T.late, border: `1px solid ${T.line}` }}>
          {demo ? "Criar minha conta grátis" : "Sair da conta"}
        </button>
      </div>
    </>
  );
}
