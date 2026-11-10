window.__ModuleLoader__.load({
  id: '@local/dsh-html-output-client-compat',
  factory() {
    function documentSource(html) {
      if (/<!doctype\s+html/i.test(html) || /<html[\s>]/i.test(html)) return html;
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:15px system-ui,sans-serif;line-height:1.5}</style></head><body>' + html + '</body></html>';
    }

    function exportDocument(html) {
      const script = `
        window.addEventListener('message', async event => {
          if (event.source !== parent || event.data?.type !== 'dsh-html-png') return;
          const id = event.data.id;
          try {
            await document.fonts.ready;
            const width = Math.max(document.documentElement.scrollWidth, innerWidth);
            const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
            if (width * height > 24000000 || height > 20000) throw new Error('页面过大，无法导出 PNG');
            const canvas = await html2canvas(document.documentElement, {
              backgroundColor: '#ffffff', scale: 1, width, height,
              windowWidth: innerWidth, windowHeight: innerHeight,
              useCORS: true, allowTaint: false, logging: false, imageTimeout: 10000,
            });
            parent.postMessage({ type: 'dsh-html-png-result', id, png: canvas.toDataURL('image/png') }, '*');
          } catch (error) {
            parent.postMessage({ type: 'dsh-html-png-result', id, error: error.message || String(error) }, '*');
          }
        });`;
      return documentSource(html) + '<script>' + captureLibrary.replace(/<\/script/gi, '<\\/script') + '\n' + script + '</script>';
    }

    // Correlation only: responses must also come from this exact iframe.
    // A module-local sequence works on HTTP pages without secure-context APIs.
    let captureSequence = 0;
    function captureFrame(frame, signal) {
      return new Promise((resolve, reject) => {
        const id = `html-png-${Date.now()}-${++captureSequence}`;
        const finish = (error, value) => {
          clearTimeout(timer);
          window.removeEventListener('message', receive);
          signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(new Error('导出已取消'));
        const receive = event => {
          if (event.source !== frame.contentWindow || event.data?.type !== 'dsh-html-png-result' || event.data.id !== id) return;
          finish(event.data.error ? new Error(event.data.error) : null, event.data.png);
        };
        const timer = setTimeout(() => finish(new Error('PNG 渲染超时，请等待页面加载后重试')), 30000);
        window.addEventListener('message', receive);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        frame.contentWindow.postMessage({ type: 'dsh-html-png', id }, '*');
      });
    }

    function prepareSvg(source) {
      try {
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        const svg = doc.documentElement;
        if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('SVG 格式无效，请检查标签和 XML 转义');
        const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        const dimension = name => {
          const value = svg.getAttribute(name) || '';
          return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : 0;
        };
        const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
        const width = hasBox ? box[2] : dimension('width') || 800;
        const height = hasBox ? box[3] : dimension('height') || 450;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!hasBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        const text = new XMLSerializer().serializeToString(svg);
        return { text, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), width, height };
      } catch (error) {
        return { error: error.message || String(error) };
      }
    }

    function captureSvg(svg, signal) {
      return new Promise((resolve, reject) => {
        if (svg.error) return reject(new Error(svg.error));
        const width = Math.ceil(Math.min(1600, Math.max(600, svg.width)));
        const height = Math.ceil(width * svg.height / svg.width);
        if (width * height > 24000000 || height > 20000) return reject(new Error('图表过大，无法导出 PNG'));
        const image = new Image();
        const finish = (error, value) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          image.onload = image.onerror = null;
          image.src = '';
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(new Error('导出已取消'));
        const timer = setTimeout(() => finish(new Error('SVG 渲染超时')), 30000);
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器不支持 Canvas 导出');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            finish(null, canvas.toDataURL('image/png'));
          } catch (error) { finish(error); }
        };
        image.onerror = () => finish(new Error('SVG 图片加载失败，请使用自包含 SVG'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        image.src = svg.url;
      });
    }

    function commandResult(response) {
      if (!response?.ok) throw new Error(response?.error?.message || '保存请求失败');
      const result = response.value?.result;
      if (!result) throw new Error('保存命令不可用');
      if (result.kind !== 'success') throw new Error(result.text || '保存失败');
      return result;
    }

    // A code block becomes a preview when its fence says html/svg, or when it holds a
    // standalone SVG whatever the fence said. Other code keeps its native rendering.
    function previewKind(text, language) {
      if (/^(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|>)/i.test(text)) return 'svg';
      return language === 'html' || language === 'svg' ? language : null;
    }

    function cardTitle(text, kind) {
      const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const title = match?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      return title ? title.slice(0, 80) : kind === 'svg' ? 'SVG 图表' : 'HTML 输出';
    }

    const CARD_STYLE = 'margin:12px 0;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));border-radius:10px;overflow:visible;background:var(--dsw-alias-bg-base, rgba(128,128,128,.05))';
    const BAR_STYLE = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))';
    const ITEM_STYLE = 'display:block;width:100%;padding:8px 14px;color:inherit;background:transparent;border:0;text-align:left;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap';

    // The card is plain DOM: the Markdown renderer owns the block it replaces, and a
    // plugin cannot shadow that renderer (a keyed entry may not redeclare the child
    // slots the shipped entry owns), so the card is inserted beside the block.
    function buildCard(preview, svg, save) {
      const section = document.createElement('section');
      section.className = 'dsh-html-preview';
      section.dataset.htmlPreview = preview.kind;
      section.style.cssText = CARD_STYLE;

      const header = document.createElement('header');
      header.style.cssText = BAR_STYLE;
      const title = document.createElement('strong');
      title.style.cssText = 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      title.textContent = preview.title;
      const menu = document.createElement('details');
      menu.style.cssText = 'position:relative;flex:none';
      const summary = document.createElement('summary');
      summary.textContent = '⋯';
      summary.title = '导出选项';
      summary.setAttribute('aria-label', '导出选项');
      summary.style.cssText = 'list-style:none;cursor:pointer;padding:0 8px;font-size:22px;line-height:28px';
      const items = document.createElement('div');
      items.style.cssText = 'position:absolute;right:0;top:100%;z-index:10;min-width:150px;border-radius:8px;border:1px solid currentColor;background:var(--dsw-alias-bg-base, Canvas);color:var(--dsw-alias-text-primary, CanvasText);padding:4px 0';
      const status = document.createElement('div');
      status.hidden = true;
      status.setAttribute('role', 'status');
      status.style.cssText = 'padding:6px 10px;font-size:12px;overflow-wrap:anywhere';

      let frame = null;
      let busy = false;
      const report = message => {
        status.hidden = false;
        status.textContent = message;
      };
      const action = (label, format) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = ITEM_STYLE;
        button.addEventListener('click', async () => {
          menu.open = false;
          if (busy) return;
          busy = true;
          report('正在保存…');
          try { report(`已保存：${await save(preview, format, svg, frame)}`); }
          catch (error) { report(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
          finally { busy = false; }
        });
        return button;
      };
      const first = action(preview.kind === 'svg' ? '保存为 SVG' : '保存为 HTML', preview.kind);
      const png = action('保存为 PNG', 'png');
      if (svg?.error) first.disabled = png.disabled = true;
      items.append(first, png);
      menu.append(summary, items);
      header.append(title, menu);
      section.append(header, status);
      if (svg && !svg.error) {
        const image = document.createElement('img');
        image.alt = preview.title;
        image.src = svg.url;
        image.style.cssText = 'display:block;width:100%;height:auto;border-radius:0 0 10px 10px;background:#fff';
        section.append(image);
      } else if (svg) {
        report(svg.error);
      } else {
        frame = document.createElement('iframe');
        frame.title = preview.title;
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(exportDocument(preview.html));
        frame.style.cssText = 'display:block;width:100%;height:420px;border:0;border-radius:0 0 10px 10px;background:#fff';
        section.append(frame);
      }
      return section;
    }

    return {
      inject: ['slots', 'remote', 'remote.commands'],
      apply(ctx) {
        const saveHtml = (sessionId, input) => ctx.remote.commands.execute(sessionId, (input.format === 'svg' ? '/svg-output-save ' : '/html-output-save ') + JSON.stringify(input), []);
        // The save command is addressed to the viewed Session. A Client half learns it
        // from a Slot entry's props, so this inert entry carries it and nothing else.
        const session = { id: '' };
        const save = async (preview, format, svg, frame) => {
          if (!session.id) throw new Error('会话尚未就绪，请稍后重试');
          const controller = new AbortController();
          const input = format === 'png'
            ? { format, png: preview.kind === 'svg' ? await captureSvg(svg, controller.signal) : await captureFrame(frame, controller.signal), title: preview.title }
            : preview.kind === 'svg'
              ? { format, svg: svg.text, title: preview.title }
              : { format, html: documentSource(preview.html), title: preview.title };
          const result = commandResult(await saveHtml(session.id, input));
          return result.text;
        };
        // In place: every assistant code block that holds a diagram becomes a card at
        // its own position. The block stays as the source whenever the card cannot
        // render it, so nothing the model wrote is lost.
        const registry = new Map();
        const scan = () => {
          const live = new Set();
          for (const block of document.querySelectorAll('.md-code-block')) {
            const content = block.querySelector('[data-code-block-content] pre');
            const text = (content?.textContent ?? '').trim();
            if (!text) continue;
            const banner = block.querySelector('[data-code-block-banner]');
            const language = (banner?.firstElementChild?.textContent ?? '').trim().toLowerCase();
            const kind = previewKind(text, language);
            if (!kind) continue;
            const svg = kind === 'svg' ? prepareSvg(text) : null;
            // An unfinished or invalid SVG keeps its source; the card appears once it parses.
            if (svg?.error) continue;
            const current = registry.get(block);
            if (current?.card.isConnected && current.text === text) { live.add(block); continue; }
            current?.card.remove();
            const card = buildCard({ kind, html: text, title: cardTitle(text, kind) }, svg, save);
            block.parentNode?.insertBefore(card, block);
            block.hidden = true;
            block.style.display = 'none';
            registry.set(block, { card, text });
            live.add(block);
          }
          for (const [block, entry] of registry) {
            if (live.has(block)) continue;
            entry.card.remove();
            block.hidden = false;
            block.style.display = '';
            registry.delete(block);
          }
        };
        ctx.effect(() => {
          let timer = null;
          const schedule = () => {
            if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 60);
          };
          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          scan();
          return () => {
            observer.disconnect();
            if (timer) clearTimeout(timer);
            for (const [block, entry] of registry) {
              entry.card.remove();
              block.hidden = false;
              block.style.display = '';
            }
            registry.clear();
          };
        }, 'dsh-html-output-client-compat: inline previews');
        const SessionProbe = function SessionProbe({ sessionId }) {
          session.id = sessionId;
          return null;
        };
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: 'html-output-preview-compat', order: 150,
        }, SessionProbe));
      },
    };
  },
});
