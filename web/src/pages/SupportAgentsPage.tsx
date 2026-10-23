import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  Headphones,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "../api";
import type { SupportAgent } from "../types";
import { fullTime } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { useToast } from "../store/ToastContext";
import "../support.css";

type Editor =
  | { kind: "create" }
  | { kind: "edit" | "password" | "toggle"; agent: SupportAgent };

function AgentRow({
  agent,
  onEdit,
}: {
  agent: SupportAgent;
  onEdit: (editor: Editor) => void;
}) {
  return (
    <tr>
      <td className="agents-identity-cell">
        <div className="agents-person">
          <Avatar name={agent.name} size={36} />
          <span>
            <strong>{agent.name}</strong>
            <small>客服</small>
          </span>
        </div>
      </td>
      <td data-label="登录账号">
        <code>{agent.username}</code>
      </td>
      <td data-label="账号状态">
        <span className={`agents-status ${agent.enabled ? "enabled" : ""}`}>
          <i />
          {agent.enabled ? "已启用" : "已停用"}
        </span>
      </td>
      <td data-label="最近登录">
        {agent.lastLoginAt ? fullTime(agent.lastLoginAt) : "尚未登录"}
      </td>
      <td data-label="创建时间">{fullTime(agent.createdAt)}</td>
      <td className="agents-actions-cell">
        <div className="agents-row-actions">
          <button
            title="编辑客服"
            onClick={() => onEdit({ kind: "edit", agent })}
          >
            <Pencil size={14} />
            编辑
          </button>
          <button onClick={() => onEdit({ kind: "password", agent })}>
            <KeyRound size={14} />
            重置密码
          </button>
          <button
            className={agent.enabled ? "danger" : ""}
            onClick={() => onEdit({ kind: "toggle", agent })}
          >
            <Power size={14} />
            {agent.enabled ? "停用" : "启用"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function SupportAgentsPage() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const loginUrl = `${window.location.origin}/support/login`;
  const accounts = useQuery({
    queryKey: ["support-agents"],
    queryFn: () => api<{ items: SupportAgent[] }>("/api/support-agents"),
  });
  const items = accounts.data?.items ?? [];
  const filtered = items.filter((agent) =>
    `${agent.name} ${agent.username}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const open = (next: Editor) => {
    setEditor(next);
    setName("agent" in next ? next.agent.name : "");
    setUsername("agent" in next ? next.agent.username : "");
    setPassword("");
    setFormError("");
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!editor) return;
      if (editor.kind === "create")
        return api("/api/support-agents", {
          method: "POST",
          json: { name, username, password },
        });
      if (editor.kind === "password")
        return api(`/api/support-agents/${editor.agent.id}/password`, {
          method: "POST",
          json: { password },
        });
      return api(`/api/support-agents/${editor.agent.id}`, {
        method: "PATCH",
        json:
          editor.kind === "toggle"
            ? { enabled: !editor.agent.enabled }
            : { name },
      });
    },
    onSuccess: () => {
      toast(
        editor?.kind === "create"
          ? "客服账号已开通，可通过独立入口登录"
          : editor?.kind === "password"
            ? "密码已重置，原登录会话已失效"
            : "客服账号已更新",
      );
      setEditor(null);
      setPassword("");
      void client.invalidateQueries({ queryKey: ["support-agents"] });
    },
    onError: (error) =>
      setFormError(
        error instanceof Error ? error.message : "操作失败，请重试。",
      ),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const title =
    editor?.kind === "create"
      ? "开通客服账号"
      : editor?.kind === "password"
        ? "重置登录密码"
        : editor?.kind === "toggle"
          ? editor.agent.enabled
            ? "停用客服账号"
            : "启用客服账号"
          : "编辑客服姓名";

  return (
    <div className="page-enter agents-page">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">客服账号</h2>
          <p className="page-sub">
            为团队开通独立聊天账号，让每位客服专注客户沟通。
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => open({ kind: "create" })}
        >
          <Plus size={16} />
          开通客服账号
        </button>
      </div>
      <section className="agents-access-card card">
        <span className="agents-access-icon">
          <Headphones size={25} />
        </span>
        <div>
          <strong>独立的客服聊天系统</strong>
          <p>客服登录后直接进入聊天界面，无需进入管理后台。</p>
          <code>{loginUrl}</code>
        </div>
        <div className="agents-access-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(loginUrl)
                .then(() => toast("客服登录地址已复制"))
                .catch(() => toast("复制失败，请手动复制地址", "error"));
            }}
          >
            <Copy size={14} />
            复制入口
          </button>
          <a
            className="btn btn-primary btn-sm"
            href="/support/login"
            target="_blank"
            rel="noreferrer"
          >
            打开客服端
            <ExternalLink size={14} />
          </a>
        </div>
      </section>
      <div className="agents-stats">
        <div className="card">
          <Users size={20} />
          <span>
            客服账号总数<strong>{items.length}</strong>
          </span>
        </div>
        <div className="card">
          <Headphones size={20} />
          <span>
            已启用账号<strong>{items.filter((a) => a.enabled).length}</strong>
          </span>
        </div>
        <div className="card">
          <ShieldCheck size={20} />
          <span>
            权限范围<strong className="agents-scope">仅客户会话</strong>
          </span>
        </div>
      </div>
      <section className="card agents-table-card">
        <div className="agents-table-toolbar">
          <h3>
            团队成员 <span>{items.length}</span>
          </h3>
          <div className="chat-search">
            <Search size={16} />
            <input
              aria-label="搜索客服"
              placeholder="搜索姓名或账号"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {accounts.isError ? (
          <div className="agents-empty">
            加载失败。
            <button className="text-link" onClick={() => accounts.refetch()}>
              重新加载
            </button>
          </div>
        ) : accounts.isLoading ? (
          <div className="agents-empty">
            <Loader2 className="spin" size={20} />
            正在加载账号…
          </div>
        ) : (
          <div className="agents-table-scroll">
            <table className="agents-table">
              <thead>
                <tr>
                  <th>客服</th>
                  <th>登录账号</th>
                  <th>账号状态</th>
                  <th>最近登录</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} onEdit={open} />
                ))}
              </tbody>
            </table>
            {!filtered.length ? (
              <div className="agents-empty">
                <Headphones size={28} />
                <strong>
                  {search ? "没有找到匹配的客服" : "还没有客服账号"}
                </strong>
                <p>
                  {search
                    ? "换个关键词试试"
                    : "点击“开通客服账号”，邀请第一位客服加入团队。"}
                </p>
              </div>
            ) : null}
          </div>
        )}
        <div className="agents-permission-note">
          <ShieldCheck size={15} />
          客服可共享客户会话、发送文字和附件；不能访问管理后台或更改系统设置。
        </div>
      </section>
      <Modal
        open={Boolean(editor)}
        title={title}
        description={
          editor?.kind === "create"
            ? "开通后，将登录账号、密码与客服端地址交给对应客服。"
            : undefined
        }
        onClose={() => {
          if (!save.isPending) setEditor(null);
        }}
      >
        <form className="agents-form" onSubmit={submit}>
          {editor?.kind === "create" || editor?.kind === "edit" ? (
            <>
              <label>
                客服姓名
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={30}
                  placeholder="例如：小林"
                  required
                />
              </label>
              <label>
                登录账号
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={40}
                  minLength={3}
                  placeholder="例如：kefu01"
                  disabled={editor.kind === "edit"}
                  required
                />
                <small>3–40 位英文字母、数字、下划线、点或短横线</small>
              </label>
            </>
          ) : null}
          {editor?.kind === "create" || editor?.kind === "password" ? (
            <label>
              {editor.kind === "create" ? "初始密码" : "新密码"}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                placeholder="至少 8 位，请使用较强的密码"
                required
              />
              <small>
                {editor.kind === "password"
                  ? "重置后，该客服所有旧登录会话将立即失效。"
                  : "请通过安全方式将密码告知对应客服。"}
              </small>
            </label>
          ) : null}
          {editor?.kind === "toggle" ? (
            <p className="agents-confirm">
              {editor.agent.enabled
                ? `停用“${editor.agent.name}”后，将立即退出其已登录的聊天工作台，并禁止继续登录。现有客户和聊天记录不受影响。`
                : `启用“${editor.agent.name}”后，该客服可使用原账号及密码登录聊天工作台。`}
            </p>
          ) : null}
          {formError ? (
            <div className="form-error" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="agents-form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={save.isPending}
              onClick={() => setEditor(null)}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? <Loader2 className="spin" size={15} /> : null}
              {save.isPending
                ? "正在保存…"
                : editor?.kind === "create"
                  ? "确认开通"
                  : "确认"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
