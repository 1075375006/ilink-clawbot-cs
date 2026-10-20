import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  RefreshCw,
  Search,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { User } from "../types";
import { dayjs, fullTime, fromNow, loginLabel } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { WindowPill } from "../components/WindowPill";
import { EmptyState } from "../components/EmptyState";
import { useNow, remainingSeconds } from "../lib/useNow";

interface UsersResponse {
  items: User[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function CustomersPage() {
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState("bound_desc");
  const [windowFilter, setWindowFilter] = useState<"all" | "open" | "closed" | "invalid">(
    "all",
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 260);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["users", debounced, sort, page, windowFilter],
    queryFn: () =>
      api<UsersResponse>(
        `/api/users?search=${encodeURIComponent(debounced)}&sort=${sort}&page=${page}&pageSize=20&window=${
          windowFilter === "invalid" ? "all" : windowFilter
        }&clawbot=${windowFilter === "invalid" ? "invalid" : "all"}`,
      ),
  });

  const activeCount = useMemo(
    () =>
      (data?.items ?? []).filter(
        (user) =>
          user.accountStatus !== "session_expired" &&
          remainingSeconds(user.windowExpiresAt, now) > 0,
      ).length,
    [data, now],
  );

  return (
    <div className="page-enter">
      <div className="page-heading-row">
        <div>
          <h2 className="page-title">客户档案</h2>
          <p className="page-sub">
            共 {data?.total ?? 0} 位已完成绑定的客户，本页 {activeCount} 位仍在会话窗口内。
          </p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={16} className={isFetching ? "spin" : ""} />
            刷新
          </button>
          <Link to="/invite" className="btn btn-primary">
            <UserRoundPlus size={16} />
            邀请新客户
          </Link>
        </div>
      </div>

      <section className="card table-card">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索昵称、备注或 social_uid"
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => setSearch("")}>
                清除
              </button>
            ) : null}
          </div>
          <label className="select-wrap">
            <select
              value={windowFilter}
              onChange={(event) => {
                setWindowFilter(
                  event.target.value as "all" | "open" | "closed" | "invalid",
                );
                setPage(1);
              }}
            >
              <option value="all">全部客户</option>
              <option value="open">窗口有效</option>
              <option value="closed">窗口关闭</option>
              <option value="invalid">ClawBot 失效</option>
            </select>
          </label>
          <label className="select-wrap">
            <ArrowUpDown size={15} />
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="bound_desc">绑定时间：从新到旧</option>
              <option value="bound_asc">绑定时间：从旧到新</option>
              <option value="active_desc">最后活跃：从近到远</option>
              <option value="active_asc">最后活跃：从远到近</option>
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="table-loading">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div className="skeleton-row" key={item}>
                <span className="skeleton" style={{ width: 40, height: 40, borderRadius: 40 }} />
                <span className="skeleton" style={{ width: 130, height: 14 }} />
                <span className="skeleton" style={{ width: 110, height: 14 }} />
                <span className="skeleton" style={{ width: 90, height: 14 }} />
                <span className="skeleton" style={{ width: 100, height: 24, borderRadius: 20 }} />
              </div>
            ))}
          </div>
        ) : data && data.items.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>身份来源</th>
                    <th>绑定时间</th>
                    <th>最后活跃</th>
                    <th>会话窗口</th>
                    <th className="th-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => {
                    const seconds = remainingSeconds(user.windowExpiresAt, now);
                    return (
                      <tr key={user.id} onClick={() => navigate(`/workbench/${user.id}`)} className="clickable-row">
                        <td>
                          <div className="person-cell">
                            <span className="avatar-wrap">
                              <Avatar src={user.avatar} name={user.name} size={40} />
                              {user.unread > 0 ? <i className="avatar-badge">{user.unread}</i> : null}
                            </span>
                            <span>
                              <strong>{user.name}</strong>
                              <small>{user.socialUid ? `${user.socialUid.slice(0, 12)}…` : "资料待完善"}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="login-badge">{loginLabel(user.loginType)}</span>
                        </td>
                        <td>
                          <span className="cell-strong">{dayjs(user.boundAt).format("YYYY/MM/DD")}</span>
                          <small className="cell-sub">{dayjs(user.boundAt).format("HH:mm")}</small>
                        </td>
                        <td>
                          <span className="cell-strong">{fromNow(user.lastActiveAt)}</span>
                          <small className="cell-sub">{fullTime(user.lastActiveAt)}</small>
                        </td>
                        <td>
                          <WindowPill
                            seconds={seconds}
                            replyRemaining={user.replyRemaining}
                            accountStatus={user.accountStatus}
                          />
                        </td>
                        <td className="td-right">
                          <button
                            type="button"
                            className="btn btn-tiny"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/workbench/${user.id}`);
                            }}
                          >
                            <MessageCircle size={14} />
                            发起对话
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                第 {data.page} / {data.totalPages} 页 · 共 {data.total} 位客户
              </span>
              <div className="pagination">
                <button
                  type="button"
                  className="page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(5, data.totalPages) }, (_, index) => {
                  const start = Math.min(
                    Math.max(1, page - 2),
                    Math.max(1, data.totalPages - 4),
                  );
                  const value = start + index;
                  if (value > data.totalPages) return null;
                  return (
                    <button
                      type="button"
                      key={value}
                      className={`page-btn ${value === page ? "active" : ""}`}
                      onClick={() => setPage(value)}
                    >
                      {value}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="page-btn"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Users size={24} />}
            title={debounced ? "没有找到匹配的客户" : "还没有绑定客户"}
            description={
              debounced
                ? "试试其他昵称或备注名，也可以清空搜索条件。"
                : "客户扫描二维码并完成身份授权后，会自动出现在这里。"
            }
            action={
              debounced ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch("")}>
                  清空搜索
                </button>
              ) : (
                <Link to="/invite" className="btn btn-primary btn-sm">
                  去邀请客户
                </Link>
              )
            }
          />
        )}
      </section>
    </div>
  );
}
