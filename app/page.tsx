'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

type RenderResult = {
  pill: string;
  image: string; // data URI (png)
  filename: string;
};

const LABEL_HINTS = [
  'BOX ID',
  'P/N',
  'QTY',
  'MPN (QVL)',
  'Maker',
  '4L',
  'MITAC P/N description',
];

const VD_STORAGE_KEY = 'vd-code';

export default function Page() {
  const [inputs, setInputs] = useState<string[]>(Array(7).fill(''));
  const [vd, setVd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RenderResult[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [invalidInputs, setInvalidInputs] = useState<number[]>([]);

  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(VD_STORAGE_KEY);
    if (stored) setVd(stored);
  }, []);

  const counts = useMemo(() => inputs.map(text => text.split(/\r?\n/).filter(line => line.trim()).length), [inputs]);

  const onInputChange = (index: number, next: string) => {
    setInputs(prev => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
    setInvalidInputs(prev => prev.filter(i => i !== index));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setResults([]);
    setLoading(true);
    setInvalidInputs([]);
    setProgress(null);

    try {
      const columns = inputs.map(text =>
        text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
      );

      const [boxCol = [], pnCol = [], qtyCol = [], mpnCol = [], makerCol = [], fourLCol = []] = columns;
      if (!boxCol.length) {
        setInvalidInputs([0]);
        throw new Error('请至少填写 BOX ID。');
      }
      const rowCount = boxCol.length;
      const required = [
        { col: pnCol, idx: 1, name: 'P/N' },
        { col: qtyCol, idx: 2, name: 'QTY' },
        { col: mpnCol, idx: 3, name: 'MPN' },
      ];
      const optional = [
        { col: makerCol, idx: 4, name: 'Maker' },
        { col: fourLCol, idx: 5, name: '4L' },
      ];
      const invalidReq = required.filter(item => item.col.length !== rowCount);
      const invalidOpt = optional.filter(item => item.col.length !== 0 && item.col.length !== rowCount);
      const invalidIdx = [...invalidReq.map(i => i.idx), ...invalidOpt.map(i => i.idx)];
      if (invalidIdx.length) {
        setInvalidInputs(invalidIdx);
        const reqMsg = invalidReq.length
          ? `必填列行数需与 BOX ID 一致：${invalidReq.map(i => i.name).join('、')}`
          : '';
        const optMsg = invalidOpt.length
          ? `可选列若填写需与 BOX ID 行数一致：${invalidOpt.map(i => i.name).join('、')}`
          : '';
        const msg = [reqMsg, optMsg].filter(Boolean).join('；');
        throw new Error(msg || '行数不一致，请检查输入');
      }

      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, vd }),
      });

      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error || '生成失败');
      }

      // 流式读取响应
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('无法读取流式响应');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的最后一行

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'meta') {
              setProgress({ current: 0, total: msg.total });
            } else if (msg.type === 'result') {
              setResults(prev => [...prev, msg.data as RenderResult]);
              setProgress(prev => prev ? { ...prev, current: msg.index + 1 } : null);
            } else if (msg.type === 'error') {
              throw new Error(msg.error);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
          }
        }
      }

      // 处理剩余的buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer);
          if (msg.type === 'result') {
            setResults(prev => [...prev, msg.data as RenderResult]);
          } else if (msg.type === 'error') {
            throw new Error(msg.error);
          }
        } catch (e) { }
      }
    } catch (err: any) {
      setError(err?.message || '生成失败，请稍后重试');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleCopy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('copy failed');
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleBatchDownload = async () => {
    if (!results.length) return;
    setDownloading(true);
    try {
      const zip = new JSZip();

      // 使用 for...of 循环确保按顺序正确处理每个文件
      for (const item of results) {
        if (!item.image || !item.image.includes(',')) {
          console.warn('跳过无效图片:', item.filename);
          continue;
        }
        const base64 = item.image.split(',')[1];
        if (base64) {
          zip.file(item.filename || 'label.png', base64, { base64: true });
        }
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      const now = new Date();
      const pad = (v: number) => String(v).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
        now.getHours()
      )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      saveAs(blob, `labels-${stamp}.zip`);
    } catch (err) {
      console.error('批量下载失败:', err);
      alert('批量下载失败，请重试');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="app">
      <header className="header">
        <h1>
          物料入库箱单批量制作工具
          <span className="badge">MATERIAL INBOUND BOX LABEL TOOL</span>
        </h1>
      </header>
      <p className="subtitle">按照行序用 <code>||</code> 自动拼接生成物料箱单标签，同时自动生成整张标签图。</p>

      <div className="tips">
        <span className="tip-pill">每个输入框 <strong>一行一条序列号</strong></span>
        <span className="tip-pill">仅使用已填写的输入框</span>
        <span className="tip-pill">行数必须一致，例如：3 行 + 3 行 + 3 行</span>
        <span className="tip-pill">拼接格式：<code>123||456||789</code></span>
      </div>

      <form onSubmit={handleSubmit}>
        <div id="inputs">
          {inputs.map((value, index) => {
            const baseLabel = LABEL_HINTS[index] || `输入 ${index + 1}`;
            const count = counts[index];
            const isFourL = baseLabel === '4L';
            const invalid = invalidInputs.includes(index);
            return (
              <label key={baseLabel} className={invalid ? 'input-invalid' : ''}>
                <strong>{count ? `${baseLabel}（${count} 行）` : baseLabel}</strong>
                <textarea
                  className={invalid ? 'input-invalid' : ''}
                  value={value}
                  placeholder={baseLabel === 'MITAC P/N description' ? '暂时无需填写本项' : baseLabel}
                  onChange={e => onInputChange(index, isFourL ? e.target.value.toUpperCase() : e.target.value)}
                />
              </label>
            );
          })}
          <label className="vd-field">
            <strong>VD Code</strong>
            <input
              value={vd}
              onChange={e => {
                const next = e.target.value;
                setVd(next);
                localStorage.setItem(VD_STORAGE_KEY, next.trim());
              }}
              placeholder="Vendor code"
            />
          </label>
        </div>
        <div className="form-footer">
          <p className="hint">填完后点击按钮，一次性生成所有行的物料箱单标签。</p>
          <button type="submit" disabled={loading}>
            {loading
              ? progress
                ? `生成中… ${progress.current}/${progress.total}`
                : '生成中…'
              : '生成标签'}
          </button>
        </div>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="results-wrapper">
        <div className="results-header">
          <div className="results-title">
            输出结果
            <span className="results-title-badge">拼接编码 + 生成标签图</span>
          </div>
          <div className="results-actions">
            <button
              className="btn-soft"
              type="button"
              disabled={!results.length || downloading}
              onClick={handleBatchDownload}
            >
              {downloading ? '打包中…' : '批量下载'}
            </button>
          </div>
        </div>
        <section id="results" className="results">
          {results.map((item, idx) => (
            <article key={item.pill} className="card">
              <div className="card-title">第 {idx + 1} 条</div>
              <button
                className="card-pill"
                type="button"
                onClick={async () => {
                  const ok = await handleCopy(item.pill);
                  if (ok) {
                    setCopiedIndex(idx);
                    setTimeout(() => setCopiedIndex(null), 1400);
                  }
                }}
              >
                {copiedIndex === idx ? '已复制' : item.pill}
              </button>
              <a href={item.image} target="_blank" rel="noopener noreferrer">
                <img src={item.image} alt={`标签预览 ${idx + 1}`} loading="lazy" />
              </a>
            </article>
          ))}
          {!results.length && <div style={{ color: 'var(--text-muted)', padding: '12px' }}>生成后会在此显示结果。</div>}
        </section>
      </div>

      <div className="footer">自动生成标签图，批量下载后直接打印即可。</div>
    </main>
  );
}
