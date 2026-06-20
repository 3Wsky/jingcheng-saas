function renderAdminLoginPage(errorText = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>顺为运营后台登录</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --line: #e4e7ec;
      --line-strong: #d0d5dd;
      --text: #101828;
      --muted: #667085;
      --brand: #d92d20;
      --brand-dark: #b42318;
      --brand-soft: #fff1f0;
      --ink: #171b24;
      --shadow: 0 14px 34px rgba(16, 24, 40, .12);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
    }

    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .shell {
      width: min(960px, 100%);
      min-height: 520px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 380px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .intro {
      padding: 38px;
      background: var(--ink);
      color: #fff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .mark {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: var(--brand);
      display: grid;
      place-items: center;
      font-weight: 900;
      font-size: 18px;
    }

    h1 {
      margin: 34px 0 0;
      max-width: 420px;
      font-size: 30px;
      line-height: 1.2;
      font-weight: 850;
    }

    .desc {
      margin-top: 14px;
      max-width: 460px;
      color: #b8c0cc;
      line-height: 1.7;
    }

    .status {
      display: grid;
      gap: 10px;
      color: #d7deea;
      font-size: 13px;
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #12b76a;
    }

    .form-wrap {
      padding: 38px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    h2 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      font-weight: 850;
    }

    .hint {
      margin-top: 10px;
      color: var(--muted);
      line-height: 1.5;
    }

    form {
      margin-top: 26px;
      display: grid;
      gap: 14px;
    }

    label {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    input {
      width: 100%;
      height: 38px;
      padding: 0 11px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
      outline: none;
    }

    input:focus {
      border-color: var(--brand);
      box-shadow: 0 0 0 3px rgba(217, 45, 32, .12);
    }

    button {
      height: 40px;
      border: 1px solid var(--brand);
      border-radius: 6px;
      background: var(--brand);
      color: #fff;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    button:hover {
      background: var(--brand-dark);
      border-color: var(--brand-dark);
    }

    .error {
      min-height: 34px;
      padding: 8px 10px;
      border: 1px solid #fecdca;
      border-radius: 6px;
      background: var(--brand-soft);
      color: var(--brand-dark);
      line-height: 1.3;
    }

    .foot {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 820px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .intro {
        min-height: 240px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="intro">
      <div>
        <div class="brand">
          <div class="mark">顺</div>
          <div>
            <strong>顺为运营后台</strong>
            <div class="desc" style="margin-top: 3px;">Shunwei Admin</div>
          </div>
        </div>
        <h1>进入活动运营、奖品发放和后续业务管理。</h1>
        <div class="desc">当前新后端先接管新客抽奖模块，后台配置、开奖记录和发放状态已经纳入会话保护。</div>
      </div>
      <div class="status">
        <div class="status-row"><span class="dot"></span><span>本地开发服务在线</span></div>
        <div class="status-row"><span class="dot"></span><span>会话 Cookie 使用 HttpOnly</span></div>
      </div>
    </section>
    <section class="form-wrap">
      <h2>管理员登录</h2>
      <div class="hint">登录后才能访问后台页面和管理接口。</div>
      <form method="post" action="/admin/login">
        ${errorText ? `<div class="error">${escapeHtml(errorText)}</div>` : ''}
        <label>
          账号
          <input name="username" autocomplete="username" autofocus />
        </label>
        <label>
          密码
          <input name="password" type="password" autocomplete="current-password" />
        </label>
        <button type="submit">登录后台</button>
      </form>
      <div class="foot">本地默认账号由环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖。</div>
      <div class="foot" style="margin-top:10px;opacity:.75;">技术支持：<strong>FZLSaas</strong> · 反重力人工智能工作室</div>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { renderAdminLoginPage };
