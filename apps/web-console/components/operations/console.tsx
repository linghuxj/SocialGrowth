'use client';
import React, { useState, useSyncExternalStore } from 'react';
import {
  LayoutDashboard,
  Users,
  Library,
  ClipboardList,
  CalendarClock,
  ExternalLink,
  ChartNoAxesCombined,
  Handshake,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import { href, pages, readRoute } from '@/lib/operations';
import { useOperations } from '@/lib/operations-context';
import { Accounts, Clients, Content } from './registry';
import { Destinations, Plans, Rules, Strategies } from './workflow';
import {
  Audit,
  Connections,
  Home,
  Metrics,
  Receipts,
  Reviews,
} from './results';
const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};
const groups = [
  { id: 'home', name: '工作台', icon: LayoutDashboard },
  { id: 'accounts', name: '账号管理', icon: Users },
  { id: 'content', name: '内容资产', icon: Library },
  { id: 'strategy', name: '策略管理', icon: ClipboardList },
  { id: 'execution', name: '发布执行', icon: CalendarClock },
  { id: 'destinations', name: '导流管理', icon: ExternalLink },
  { id: 'data', name: '数据与复盘', icon: ChartNoAxesCombined },
  { id: 'clients', name: '客户服务', icon: Handshake },
  { id: 'system', name: '系统管理', icon: Settings },
];
export function OperationsConsole() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  const route = readRoute(hash);
  const { page, query } = route;
  const { ready, storageError } = useOperations();
  const [menu, setMenu] = useState(false);
  const current = pages.find((p) => p.id === page)!;
  const view = () => {
    switch (page) {
      case 'home':
        return <Home {...route} />;
      case 'clients':
        return <Clients {...route} />;
      case 'accounts':
        return <Accounts {...route} />;
      case 'content':
        return <Content {...route} />;
      case 'rules':
        return <Rules {...route} />;
      case 'strategies':
        return <Strategies {...route} />;
      case 'plans':
        return <Plans {...route} />;
      case 'destinations':
        return <Destinations {...route} />;
      case 'receipts':
        return <Receipts {...route} />;
      case 'exceptions':
        return <Receipts {...route} exceptions />;
      case 'metrics':
        return <Metrics {...route} />;
      case 'reviews':
        return <Reviews {...route} />;
      case 'audit':
        return <Audit {...route} />;
      case 'connections':
        return <Connections />;
    }
  };
  return (
    <div className="operations">
      <header className="op-header">
        <button
          aria-label={menu ? '关闭导航' : '打开导航'}
          aria-expanded={menu}
          className="op-menu-button"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X size={20} /> : <Menu size={20} />}
        </button>
        <a href={href('home')} className="op-brand">
          <span>SG</span>SocialGrowth <strong>运营管理</strong>
        </a>
        <a href={href('connections')} className="op-environment">
          本机执行工作区 · 发布结果以证据为准
        </a>
      </header>
      <div className="op-layout">
        <aside className={`op-sidebar ${menu ? 'is-open' : ''}`}>
          <nav aria-label="运营业务导航">
            {groups.map((group) => {
              const children = pages.filter((p) => p.group === group.id);
              const Icon = group.icon;
              return children.length === 1 ? (
                <a
                  key={group.id}
                  href={href(children[0].id)}
                  onClick={() => setMenu(false)}
                  aria-current={page === children[0].id ? 'page' : undefined}
                >
                  <Icon size={18} />
                  {group.name}
                </a>
              ) : (
                <details
                  key={group.id}
                  open={current.group === group.id || undefined}
                  className={group.id === 'system' ? 'op-nav-system' : ''}
                >
                  <summary>
                    <Icon size={18} />
                    {group.name}
                  </summary>
                  <div>
                    {children.map((p) => (
                      <a
                        key={p.id}
                        href={href(p.id)}
                        onClick={() => setMenu(false)}
                        aria-current={page === p.id ? 'page' : undefined}
                      >
                        {p.name}
                      </a>
                    ))}
                  </div>
                </details>
              );
            })}
          </nav>
          <p className="op-nav-foot">
            按业务对象统一管理
            <br />
            服务范围在业务详情中关联
          </p>
        </aside>
        <main className="op-main">
          <div className="op-title">
            <h1>{current.name}</h1>
            {page !== 'connections' && (
              <form
                className="op-search"
                key={`${page}:${query}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = new FormData(e.currentTarget).get('q');
                  window.location.assign(
                    href(page, route.object, typeof q === 'string' ? q : ''),
                  );
                }}
              >
                <label className="sr-only" htmlFor="page-search">
                  搜索当前页面
                </label>
                <input
                  id="page-search"
                  name="q"
                  type="search"
                  placeholder="搜索名称、归属或状态"
                  defaultValue={query}
                />
                <button type="submit">搜索</button>
                {query && <a href={href(page, route.object)}>清除</a>}
              </form>
            )}
          </div>
          {!ready ? (
            <output>{storageError || '正在连接执行服务…'}</output>
          ) : (
            <div key={`${page}:${route.object}`}>{view()}</div>
          )}
        </main>
      </div>
      <footer className="op-footer">
        本地操作者 · 业务操作留痕 · 数据未同步至外部服务
      </footer>
    </div>
  );
}
