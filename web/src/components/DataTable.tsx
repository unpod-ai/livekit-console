import { useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Columns3, Search } from 'lucide-react';
import { Empty, ErrorMsgInline, SkeletonRows } from './table-bits';

export type Col<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  text?: (row: T) => string; // what the search box matches against
  hidden?: boolean; // hidden by default
  wrap?: boolean;
};

type Props<T> = {
  rows?: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  loading?: boolean;
  error?: unknown;
  search?: boolean;
  pageSize?: number | false;
  storageKey?: string;
  empty?: { title: string; hint?: ReactNode };
  toolbar?: ReactNode;
  footer?: ReactNode;
  initialQuery?: string;
  mobile?: boolean;
};

/** Dense table with search, sortable headers, column visibility (remembered) and client paging. */
export function DataTable<T>({ rows, cols, rowKey, onRow, rowActions, loading, error, search = true, pageSize = 25, storageKey, empty, toolbar, footer, initialQuery, mobile = false }: Props<T>) {
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:820px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width:820px)');const update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const lsKey = storageKey ? `lkc.cols.${storageKey}` : null;
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => {
    const defaults=Object.fromEntries(cols.filter(c=>c.hidden).map(c=>[c.key,true]));
    try { const saved=lsKey?JSON.parse(localStorage.getItem(lsKey)??'null'):null;
      return saved&&typeof saved==='object'&&!Array.isArray(saved)?{...defaults,...(Object.fromEntries(Object.entries(saved).filter(([key,value])=>cols.some(c=>c.key===key)&&typeof value==='boolean')) as Record<string,boolean>)}:defaults;
    } catch { return defaults; }
  });
  const [q, setQ] = useState(initialQuery ?? '');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState(false);
  const columnMenu = useRef<HTMLDivElement>(null), columnButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!menu) return;
    columnMenu.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); columnButton.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!columnMenu.current?.contains(e.target as Node) && !columnButton.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away); };
  }, [menu]);

  const visible = cols.filter((c) => !hidden[c.key]);
  const processed = useMemo(() => {
    let r = rows ?? [];
    if (q.trim()) {
      const needle = q.toLowerCase();
      r = r.filter((row) => cols.some((c) => (c.text ? c.text(row) : '').toLowerCase().includes(needle)));
    }
    const sc = sort && cols.find((c) => c.key === sort.key);
    if (sc?.sort) {
      const f = sc.sort;
      r = [...r].sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sort!.dir);
    }
    return r;
  }, [rows, q, sort, cols]);

  const size = pageSize || processed.length || 1;
  const pages = Math.max(1, Math.ceil(processed.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = pageSize ? processed.slice(cur * size, cur * size + size) : processed;

  const toggle = (key: string) => {
    const next = { ...hidden, [key]: !hidden[key] };
    setHidden(next);
    try { if(lsKey)localStorage.setItem(lsKey,JSON.stringify(next)); } catch { /* Column choices still work when storage is unavailable. */ }
  };

  return (
    <div className={mobile?'has-mobile-records':undefined}>
      {(toolbar || (search && ((rows?.length??0)>0 || q || loading))) && <div className="panel-head" style={{ borderTop: 0 }}>
        <div className="table-tools">{toolbar}</div>
        <div className="table-tools">
          {search && (
            <div className="search-wrap">
              <Search size={14} aria-hidden />
              <input className="input search" placeholder="Search" aria-label="Search table" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </div>
          )}
          <div className="pos-rel">
            <button ref={columnButton} className="btn secondary icon" aria-label="Column visibility" aria-expanded={menu} onClick={() => setMenu(!menu)}><Columns3 size={15} /></button>
            {menu && (
              <div ref={columnMenu} className="menu" role="group" aria-label="Visible columns">
                {cols.map((c) => (
                  <label key={c.key} className="check">
                    <input type="checkbox" checked={!hidden[c.key]} onChange={() => toggle(c.key)} /> {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>}
      {mobile&&narrow&&processed.length>0&&cols.some(c=>c.sort)&&<div className="mobile-sort">
        <label>Sort by<select className="select" aria-label="Sort records by" value={sort?.key??''} onChange={e=>{setSort(e.target.value?{key:e.target.value,dir:sort?.dir??1}:null);setPage(0);}}><option value="">Default order</option>{cols.filter(c=>c.sort).map(c=><option key={c.key} value={c.key}>{c.header}</option>)}</select></label>
        <button className="btn secondary icon" aria-label={sort?.dir===-1?'Sort ascending':'Sort descending'} disabled={!sort} onClick={()=>{if(sort)setSort({...sort,dir:sort.dir===1?-1:1});}}>{sort?.dir===-1?<ArrowUp size={16}/>:<ArrowDown size={16}/>}</button>
      </div>}
      <ErrorMsgInline error={error} />
      {loading && !rows ? (
        <SkeletonRows />
      ) : shown.length === 0 ? (
        <Empty title={q ? 'No matches' : empty?.title ?? 'Nothing here yet'}>{q ? 'Try a different search.' : empty?.hint}</Empty>
      ) : (
        <>
        {mobile&&narrow&&<div className="mobile-records">{shown.map(row=><article key={rowKey(row)} className="mobile-record">
          <div className="mobile-record-title">{visible[0]?.cell(row)}</div>
          <div className="mobile-record-meta">{visible.slice(1,4).map(c=><span key={c.key}><span>{c.header}: </span>{c.cell(row)}</span>)}</div>
          {visible.length>4&&<details className="mobile-record-extra"><summary>More details</summary>{visible.slice(4).map(c=><div key={c.key}><span className="muted">{c.header}: </span>{c.cell(row)}</div>)}</details>}
          {(onRow||rowActions)&&<div className="mobile-record-actions">{onRow&&<button className="btn ghost sm" onClick={()=>onRow(row)}>View details</button>}{rowActions?.(row)}</div>}
        </article>)}</div>}
        {(!mobile||!narrow)&&<div className="table-wrap" role="region" aria-label="Data table" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.key} className={c.sort ? 'sortable' : ''} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                    tabIndex={c.sort?0:undefined} onKeyDown={e=>{if(c.sort&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSort(sort?.key===c.key?{key:c.key,dir:(sort.dir*-1)as 1|-1}:{key:c.key,dir:1});}}} onClick={() => c.sort && setSort(sort?.key === c.key ? { key: c.key, dir: (sort.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 })}>
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} style={{ marginLeft: 4 }} /> : <ArrowDown size={11} style={{ marginLeft: 4 }} />)}
                  </th>
                ))}
                {rowActions && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)} className={onRow ? 'clickable' : ''} tabIndex={onRow?0:undefined} onKeyDown={e=>{if(onRow&&e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onRow(row);}}} onClick={() => onRow?.(row)}>
                  {visible.map((c) => <td key={c.key} className={c.wrap ? 'wrap' : ''}>{c.cell(row)}</td>)}
                  {rowActions && <td className="actions" onClick={(e) => e.stopPropagation()}>{rowActions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        </>
      )}
      {pageSize && processed.length > size && (
        <div className="pager">
          <span>{cur * size + 1}–{Math.min(cur * size + size, processed.length)} of {processed.length}</span>
          <button className="btn secondary sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
          <button className="btn secondary sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
        </div>
      )}
      {footer}
    </div>
  );
}
