import { useState } from "react";
import { supabase } from "./supabase";

const T = {
  bg: "#F1F4F2", card: "#FFFFFF", ink: "#14201C", inkSoft: "#5B6B64",
  line: "#E2E8E4", brand: "#0F4D34", late: "#B3261E", brandSoft: "#E3F0E9",
};

export default function Auth() {
  const [modo, setModo] = useState("entrar"); // entrar | criar
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErro(""); setAviso(""); setLoading(true);
    try {
      if (modo === "criar") {
        const { error } = await supabase.auth.signUp({ email, password: senha });
        if (error) throw error;
        setAviso("Conta criada! Confira seu e-mail para confirmar o cadastro e depois entre.");
        setModo("entrar");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      }
    } catch (e) {
      const m = e.message || "";
      setErro(
        m.includes("Invalid login") ? "E-mail ou senha incorretos."
        : m.includes("already registered") ? "Este e-mail já tem conta. Tente entrar."
        : m.includes("at least") ? "A senha precisa ter no mínimo 6 caracteres."
        : m.includes("Email not confirmed") ? "Confirme seu e-mail antes de entrar."
        : m
      );
    } finally {
      setLoading(false);
    }
  };

  const field = { background: T.bg, border: `1px solid ${T.line}`, color: T.ink };
  const ok = email.includes("@") && senha.length >= 6;

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: T.bg }}>
      <div className="w-full max-w-sm">
        <div className="rounded-3xl p-6 mb-4 text-center" style={{ background: T.brand }}>
          <h1 className="disp font-black text-3xl text-white">EmDia</h1>
          <p className="text-sm mt-1" style={{ color: "#9CC5B0" }}>
            Controle de pagamentos para personal trainers
          </p>
        </div>

        <div className="rounded-2xl p-5" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          <h2 className="disp font-black text-lg mb-4" style={{ color: T.ink }}>
            {modo === "entrar" ? "Entrar na sua conta" : "Criar conta grátis"}
          </h2>

          <label className="block text-xs font-semibold mb-1" style={{ color: T.inkSoft }}>E-mail</label>
          <input type="email" inputMode="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value.trim())} placeholder="voce@email.com"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-3" style={field} />

          <label className="block text-xs font-semibold mb-1" style={{ color: T.inkSoft }}>Senha</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
            placeholder="mínimo 6 caracteres"
            onKeyDown={(e) => e.key === "Enter" && ok && !loading && submit()}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-4" style={field} />

          {erro && (
            <p className="text-xs font-semibold mb-3 px-3 py-2 rounded-lg"
              style={{ background: "#FBEAE8", color: T.late }}>{erro}</p>
          )}
          {aviso && (
            <p className="text-xs font-semibold mb-3 px-3 py-2 rounded-lg"
              style={{ background: T.brandSoft, color: T.brand }}>{aviso}</p>
          )}

          <button disabled={!ok || loading} onClick={submit}
            className="w-full py-3 rounded-xl font-bold text-white text-sm"
            style={{ background: !ok || loading ? "#A9BDB2" : T.brand }}>
            {loading ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
          </button>

          <button onClick={() => { setModo(modo === "entrar" ? "criar" : "entrar"); setErro(""); setAviso(""); }}
            className="w-full mt-3 text-xs font-semibold" style={{ color: T.inkSoft }}>
            {modo === "entrar" ? "Não tem conta? Criar grátis" : "Já tem conta? Entrar"}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs">
          <a href="/?demo=1" className="font-semibold px-3 py-2 rounded-lg"
            style={{ background: T.brandSoft, color: T.brand }}>
            Ver demonstração
          </a>
          <a href="https://emdia-site-8dpe.vercel.app" target="_blank" rel="noopener"
            className="font-semibold px-3 py-2 rounded-lg"
            style={{ background: T.card, color: T.inkSoft, border: `1px solid ${T.line}` }}>
            Conheça o EmDia
          </a>
        </div>
      </div>
    </div>
  );
}
