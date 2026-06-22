function renderAdminPage(activeSection = 'lottery') {
  const isProductsPage = activeSection === 'products';
  const pageClass = isProductsPage ? 'section-products' : 'section-lottery';
  const pageCrumb = isProductsPage ? '运营中心 / 商品管理 / 展示商品' : '运营中心 / 活动运营 / 新客抽奖';
  const pageTitle = isProductsPage ? '商品管理工作台' : '新客抽奖工作台';
  const pageMeta = isProductsPage
    ? '展示型商品库独立管理，保留 CRMEB 商品参数概念，不接入交易、快递和订单链路。'
    : '活动、奖品和用户记录在这里管理；商品、礼品、积分、用户模块拆分为独立后台板块。';
  const activeSectionJson = JSON.stringify(isProductsPage ? 'products' : 'lottery');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>锦程运营后台</title>
  <style>
    :root {
      color-scheme: light;
      --sidebar-w: 224px;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --panel-soft: #fafbfc;
      --line: #e4e7ec;
      --line-strong: #d0d5dd;
      --text: #101828;
      --muted: #667085;
      --subtle: #98a2b3;
      --brand: #d92d20;
      --brand-dark: #b42318;
      --brand-soft: #fff1f0;
      --blue: #2563eb;
      --blue-soft: #eff4ff;
      --green: #079455;
      --green-soft: #ecfdf3;
      --amber: #b54708;
      --amber-soft: #fffaeb;
      --red: #d92d20;
      --red-soft: #fff1f0;
      --ink: #171b24;
      --ink-2: #242936;
      --ink-3: #333949;
      --ink-muted: #aeb6c5;
      --shadow: 0 1px 2px rgba(16, 24, 40, .04);
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
      overflow: hidden;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
      letter-spacing: 0;
    }

    button {
      height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      cursor: pointer;
      white-space: nowrap;
    }

    button.primary {
      border-color: var(--brand);
      background: var(--brand);
      color: #fff;
    }

    button.ghost {
      border-color: transparent;
      background: transparent;
      color: var(--muted);
    }

    input,
    select,
    textarea {
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      outline: none;
    }

    input:focus,
    select:focus,
    textarea:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .12);
    }

    textarea {
      height: auto;
      min-height: 72px;
      padding: 9px 10px;
      resize: vertical;
      line-height: 1.5;
    }

    .app {
      height: 100vh;
      display: flex;
      overflow: hidden;
    }

    .sidebar {
      width: var(--sidebar-w);
      flex: 0 0 var(--sidebar-w);
      background: var(--ink);
      color: #fff;
      display: flex;
      flex-direction: column;
    }

    .brand {
      height: 64px;
      padding: 0 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, .08);
    }

    .brand-mark {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #ef4444, #b42318);
      display: grid;
      place-items: center;
      font-weight: 900;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22);
    }

    .brand-name {
      font-size: 16px;
      line-height: 1.2;
      font-weight: 800;
    }

    .brand-sub {
      margin-top: 4px;
      color: var(--ink-muted);
      font-size: 12px;
      line-height: 1.2;
    }

    .nav {
      padding: 14px 10px;
      display: grid;
      gap: 2px;
      overflow-y: auto;
    }

    .nav-group {
      padding: 16px 10px 8px;
      color: var(--ink-muted);
      font-size: 12px;
      line-height: 1;
    }

    .nav-item {
      height: 42px;
      padding: 0 10px;
      border-radius: 7px;
      color: #e7ecf4;
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }

    .nav-item.active {
      background: var(--ink-3);
      color: #fff;
      font-weight: 800;
    }

    .nav-item.disabled {
      color: #808897;
    }

    .nav-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: rgba(255, 255, 255, .08);
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .nav-item.active .nav-icon {
      background: var(--brand);
    }

    .nav-label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-soon {
      color: #798190;
      font-size: 12px;
    }

    .sidebar-foot {
      margin-top: auto;
      padding: 14px;
      border-top: 1px solid rgba(255, 255, 255, .08);
    }

    .version-card {
      padding: 10px;
      border: 1px solid rgba(255, 255, 255, .08);
      border-radius: 8px;
      background: var(--ink-2);
      color: var(--ink-muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .main {
      min-width: 0;
      flex: 1;
      height: 100vh;
      overflow: auto;
      background: var(--bg);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      height: 64px;
      padding: 0 24px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, .96);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .search {
      width: min(440px, 46vw);
      position: relative;
    }

    .search input {
      width: 100%;
      padding-left: 34px;
      background: #f8fafc;
    }

    .search-mark {
      position: absolute;
      left: 12px;
      top: 8px;
      color: var(--subtle);
      font-size: 14px;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      white-space: nowrap;
    }

    .logout-form {
      margin: 0;
    }

    .env-pill,
    .status-pill,
    .avatar {
      height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      display: inline-flex;
      align-items: center;
    }

    .env-pill {
      padding: 0 10px;
      color: var(--muted);
      gap: 8px;
    }

    .status-pill {
      padding: 0 10px;
      color: var(--muted);
      gap: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
    }

    .avatar {
      width: 34px;
      justify-content: center;
      background: var(--ink);
      color: #fff;
      font-weight: 800;
    }

    .content {
      min-width: 980px;
      padding: 20px 24px 28px;
    }

    .section-products .lottery-only,
    .section-lottery .products-only {
      display: none !important;
    }

    .page-head {
      margin-bottom: 16px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
    }

    .crumb {
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .page-title {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 850;
    }

    .page-meta {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.4;
    }

    .head-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .tabs {
      height: 38px;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }

    .tab {
      height: 100%;
      padding: 0 14px;
      border-right: 1px solid var(--line);
      display: flex;
      align-items: center;
      color: var(--muted);
      font-size: 13px;
    }

    .tab:last-child {
      border-right: 0;
    }

    .tab.active {
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 800;
    }

    .workbench {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) 360px;
      gap: 16px;
      align-items: stretch;
      margin-bottom: 16px;
    }

    .campaign-card,
    .side-card,
    .metric,
    .panel {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .campaign-card {
      min-height: 210px;
      display: grid;
      grid-template-columns: 1fr 260px;
      overflow: hidden;
    }

    .campaign-main {
      padding: 20px;
    }

    .campaign-kicker {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .campaign-name {
      margin-top: 16px;
      font-size: 22px;
      line-height: 1.2;
      font-weight: 850;
    }

    .campaign-desc {
      margin-top: 10px;
      max-width: 620px;
      color: var(--muted);
      line-height: 1.7;
    }

    .campaign-actions {
      margin-top: 20px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .campaign-actions button {
      min-width: 108px;
    }

    .campaign-side {
      padding: 18px;
      border-left: 1px solid var(--line);
      background: linear-gradient(180deg, #fff, #fff7f5);
    }

    .stage-list {
      display: grid;
      gap: 12px;
    }

    .stage {
      display: grid;
      grid-template-columns: 20px 1fr;
      gap: 10px;
      align-items: start;
    }

    .stage-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--brand);
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
    }

    .stage.pending .stage-dot {
      background: #d0d5dd;
      color: #475467;
    }

    .stage-title {
      font-weight: 800;
      line-height: 1.2;
    }

    .stage-note {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .side-card {
      padding: 16px;
      min-height: 210px;
    }

    .side-card h3 {
      margin: 0 0 12px;
      font-size: 16px;
      line-height: 1.2;
    }

    .module-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .module-tile {
      min-height: 66px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
    }

    .module-tile.active {
      border-color: #fecdca;
      background: var(--brand-soft);
    }

    .module-title {
      font-weight: 800;
      line-height: 1.2;
      white-space: nowrap;
    }

    .module-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .metric {
      min-height: 112px;
      padding: 16px;
    }

    .metric-label {
      color: var(--muted);
      line-height: 1.2;
    }

    .metric-row {
      margin-top: 16px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
    }

    .metric-value {
      font-size: 30px;
      line-height: 1;
      font-weight: 850;
    }

    .metric-trend {
      height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--blue-soft);
      color: var(--blue);
      display: inline-flex;
      align-items: center;
      font-size: 12px;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) 390px;
      gap: 16px;
      align-items: start;
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .panel {
      overflow: hidden;
    }

    .panel-head {
      min-height: 56px;
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .panel-title {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
      font-weight: 850;
    }

    .panel-subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .panel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .save-state {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .filters {
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-soft);
      display: grid;
      grid-template-columns: 240px 150px 1fr;
      gap: 10px;
      align-items: center;
    }

    .product-panel {
      margin-bottom: 16px;
      scroll-margin-top: 78px;
    }

    .product-summary {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      background: #fff;
    }

    .product-stat {
      min-height: 76px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      display: grid;
      align-content: space-between;
      gap: 8px;
    }

    .product-stat span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }

    .product-stat strong {
      font-size: 24px;
      line-height: 1;
      font-weight: 850;
    }

    .product-filters {
      grid-template-columns: 260px 150px 130px 1fr;
    }

    .product-cell {
      min-width: 238px;
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }

    .product-thumb {
      width: 46px;
      height: 46px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: linear-gradient(180deg, #fff, #f2f4f7);
      color: var(--muted);
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 850;
      overflow: hidden;
    }

    .product-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .product-name {
      font-weight: 850;
      line-height: 1.25;
    }

    .product-info {
      margin-top: 5px;
      max-width: 380px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .product-mini-tags {
      margin-top: 7px;
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .mini-tag {
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: #f2f4f7;
      color: #475467;
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      line-height: 1;
    }

    .sku-line {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .product-table {
      min-width: 0;
    }

    .product-table table {
      min-width: 960px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    .table-scroll {
      width: 100%;
      overflow-x: auto;
    }

    .table-scroll table {
      min-width: 860px;
    }

    th,
    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      line-height: 1.35;
    }

    th {
      height: 42px;
      background: var(--panel-soft);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }

    .muted {
      color: var(--muted);
    }

    .badge {
      height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      white-space: nowrap;
    }

    .badge.blue {
      background: var(--blue-soft);
      color: var(--blue);
    }

    .badge.green {
      background: var(--green-soft);
      color: var(--green);
    }

    .badge.red {
      background: var(--red-soft);
      color: var(--red);
    }

    .badge.amber {
      background: var(--amber-soft);
      color: var(--amber);
    }

    .badge.gray {
      background: #f2f4f7;
      color: #475467;
    }

    .config-table th,
    .config-table td {
      padding: 11px 12px;
    }

    .config-table input,
    .config-table select {
      width: 100%;
      min-width: 0;
    }

    .config-table input[type="checkbox"] {
      width: 16px;
      height: 16px;
      padding: 0;
      accent-color: var(--brand);
    }

    .activity-form {
      padding: 14px 16px 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 110px 120px;
      gap: 12px;
      background: var(--panel);
    }

    .activity-form .wide {
      grid-column: 1 / -1;
    }

    .field {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .field label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
    }

    .field input,
    .field select,
    .field textarea {
      width: 100%;
    }

    .row-fields {
      display: grid;
      gap: 8px;
    }

    .row-fields.two {
      grid-template-columns: 1fr 1fr;
    }

    .inline-field {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .inline-field input[type="checkbox"] {
      width: 16px;
      height: 16px;
      padding: 0;
      accent-color: var(--brand);
    }

    .stock-field {
      display: grid;
      grid-template-columns: minmax(74px, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .stock-field input:disabled {
      background: #f2f4f7;
      color: var(--subtle);
    }

    .rule-field {
      display: grid;
      gap: 8px;
      min-width: 160px;
    }

    .probability-text {
      color: var(--blue);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .record-actions {
      display: grid;
      grid-template-columns: 112px minmax(120px, 1fr) 58px;
      gap: 8px;
      align-items: center;
      min-width: 292px;
    }

    .record-actions input,
    .record-actions select {
      width: 100%;
    }

    .redeem-box {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: #fffaf7;
      display: grid;
      grid-template-columns: 180px minmax(160px, 1fr) 74px;
      gap: 10px;
      align-items: center;
    }

    .redeem-box input {
      width: 100%;
    }

    .redeem-code {
      margin-top: 6px;
      color: var(--blue);
      font-weight: 850;
      letter-spacing: 1px;
    }

    .weight-cell {
      min-width: 150px;
    }

    .bar {
      height: 8px;
      border-radius: 999px;
      background: #edf1f7;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      width: 0;
      border-radius: inherit;
      background: var(--brand);
    }

    .empty {
      padding: 34px 16px;
      color: var(--muted);
      text-align: center;
    }

    @media (max-width: 1040px) {
      :root {
        --sidebar-w: 76px;
      }

      .brand {
        justify-content: center;
        padding: 0;
      }

      .brand-copy,
      .nav-label,
      .nav-soon,
      .nav-group,
      .sidebar-foot {
        display: none;
      }

      .nav {
        padding: 14px 8px;
      }

      .nav-item {
        justify-content: center;
        padding: 0;
      }

      .nav-icon {
        width: 34px;
        height: 34px;
      }

      .content {
        min-width: 0;
      }

      .topbar {
        padding: 0 16px;
      }

      .search {
        width: 260px;
      }

      .workbench,
      .grid {
        grid-template-columns: 1fr;
      }

      .campaign-card {
        grid-template-columns: 1fr;
      }

      .campaign-side {
        border-left: 0;
        border-top: 1px solid var(--line);
      }

      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .product-panel .panel-head {
        height: auto;
        min-height: 0;
        padding: 14px 16px;
        align-items: stretch;
        flex-direction: column;
      }

      .product-panel .panel-actions {
        justify-content: flex-start;
        flex-wrap: wrap;
      }

      .product-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .product-filters {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app ${pageClass}">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">锦</div>
        <div class="brand-copy">
          <div class="brand-name">锦程运营后台</div>
          <div class="brand-sub">Jingcheng Admin</div>
        </div>
      </div>
      <nav class="nav">
        <div class="nav-group">工作台</div>
        <a class="nav-item ${isProductsPage ? '' : 'active'}" href="/admin" title="新客抽奖">
          <span class="nav-icon">抽</span><span class="nav-label">新客抽奖</span>
        </a>
        <a class="nav-item ${isProductsPage ? 'active' : ''}" href="/admin/products" title="商品管理">
          <span class="nav-icon">商</span><span class="nav-label">商品管理</span>
        </a>
        <span class="nav-item disabled" title="礼品管理">
          <span class="nav-icon">礼</span><span class="nav-label">礼品管理</span><span class="nav-soon">soon</span>
        </span>
        <span class="nav-item disabled" title="用户管理">
          <span class="nav-icon">客</span><span class="nav-label">用户管理</span><span class="nav-soon">soon</span>
        </span>
        <span class="nav-item disabled" title="积分管理">
          <span class="nav-icon">积</span><span class="nav-label">积分管理</span><span class="nav-soon">soon</span>
        </span>
        <div class="nav-group">系统</div>
        <span class="nav-item disabled" title="订单与发放">
          <span class="nav-icon">单</span><span class="nav-label">订单与发放</span>
        </span>
        <span class="nav-item disabled" title="权限设置">
          <span class="nav-icon">权</span><span class="nav-label">权限设置</span>
        </span>
      </nav>
      <div class="sidebar-foot">
        <div class="version-card">
          <strong>旁路新后端</strong><br />
          当前接管新客抽奖与展示型商品库，交易链路仍由旧系统保留。
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="search">
          <span class="search-mark">⌕</span>
          <input placeholder="搜索功能、用户、奖品、订单" />
        </div>
        <div class="top-actions">
          <span class="env-pill">Local Dev</span>
          <span class="status-pill"><span id="serviceDot" class="status-dot"></span><span id="serviceStatus">连接中</span></span>
          <button id="refreshBtn" class="primary" type="button">刷新</button>
          <form class="logout-form" method="post" action="/admin/logout">
            <button type="submit">退出</button>
          </form>
          <span class="avatar">运</span>
        </div>
      </header>

      <section class="content">
        <div class="page-head">
          <div>
            <div class="crumb">${pageCrumb}</div>
            <h1 class="page-title">${pageTitle}</h1>
            <div class="page-meta">${pageMeta}</div>
          </div>
          <div class="head-actions">
            <div class="tabs lottery-only">
              <div class="tab active">概览</div>
              <div class="tab">开奖记录</div>
              <div class="tab">配置</div>
            </div>
            <div class="tabs products-only">
              <div class="tab active">商品列表</div>
              <div class="tab">官网数据</div>
              <div class="tab">参数维护</div>
            </div>
            <button id="exportBtn" class="lottery-only" type="button">导出</button>
            <button id="saveConfigTopBtn" class="primary lottery-only" type="button">保存配置</button>
          </div>
        </div>

        <section class="workbench lottery-only">
          <div class="campaign-card">
            <div class="campaign-main">
              <div class="campaign-kicker"><span id="activityStatusBadge" class="badge green">运行中</span><span>活动 ID：newcomer-lottery</span></div>
              <div id="campaignName" class="campaign-name">新客首登抽奖</div>
              <div id="campaignDesc" class="campaign-desc">面向新用户的拉新活动。当前由新后端服务端开奖，前端只负责动画展示；任务、次数、奖品记录已经从本地缓存切到服务端状态。</div>
              <div class="campaign-actions">
                <button id="viewMiniBtn" type="button" class="primary">查看接口</button>
                <button id="copyApiBtn" type="button">复制接口地址</button>
                <button id="focusConfigBtn" type="button">编辑配置</button>
              </div>
            </div>
            <div class="campaign-side">
              <div class="stage-list">
                <div class="stage">
                  <div class="stage-dot">1</div>
                  <div><div class="stage-title">后端接口</div><div class="stage-note">状态、任务、开奖、记录已接入</div></div>
                </div>
                <div class="stage">
                  <div class="stage-dot">2</div>
                  <div><div class="stage-title">小程序联调</div><div class="stage-note">页面已改为服务端开奖</div></div>
                </div>
                <div class="stage pending">
                  <div class="stage-dot">3</div>
                  <div><div class="stage-title">正式运营</div><div class="stage-note">待接权限、库存、发放和正式域名</div></div>
                </div>
              </div>
            </div>
          </div>

          <div class="side-card">
            <h3>模块规划</h3>
            <div class="module-grid">
              <div class="module-tile active"><div class="module-title">活动运营</div><div class="module-note">新客抽奖</div></div>
              <div class="module-tile active"><div class="module-title">商品管理</div><div class="module-note">展示 / SKU</div></div>
              <div class="module-tile"><div class="module-title">礼品管理</div><div class="module-note">奖品 / 发放</div></div>
              <div class="module-tile"><div class="module-title">积分管理</div><div class="module-note">积分账本</div></div>
            </div>
          </div>
        </section>

        <section class="metrics lottery-only">
          <div class="metric">
            <div class="metric-label">参与用户</div>
            <div class="metric-row"><div id="userCount" class="metric-value">--</div><span class="metric-trend">用户</span></div>
          </div>
          <div class="metric">
            <div class="metric-label">剩余抽奖次数</div>
            <div class="metric-row"><div id="totalChances" class="metric-value">--</div><span class="metric-trend">未使用</span></div>
          </div>
          <div class="metric">
            <div class="metric-label">总开奖次数</div>
            <div class="metric-row"><div id="totalRecords" class="metric-value">--</div><span class="metric-trend">记录</span></div>
          </div>
          <div class="metric">
            <div class="metric-label">中奖率</div>
            <div class="metric-row"><div id="winRate" class="metric-value">--</div><span id="wonRecords" class="metric-trend">中奖</span></div>
          </div>
        </section>

        <section id="productsPanel" class="panel product-panel products-only">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">商品管理</h2>
              <div class="panel-subtitle">展示型商品库，保留 CRMEB 商品参数概念，不接入交易、快递和订单链路。</div>
            </div>
            <div class="panel-actions">
              <span id="productImportState" class="save-state">未导入</span>
              <button id="importProductsBtn" class="primary" type="button">一键导入并上架</button>
              <button id="refreshProductsBtn" type="button">刷新商品</button>
            </div>
          </div>
          <div class="product-summary">
            <div class="product-stat"><span>商品总数</span><strong id="productTotal">--</strong></div>
            <div class="product-stat"><span>已上架</span><strong id="productShownCount">--</strong></div>
            <div class="product-stat"><span>品牌数量</span><strong id="productBrandCount">--</strong></div>
            <div class="product-stat"><span>待公布价格</span><strong id="productPendingPriceCount">--</strong></div>
          </div>
          <div class="filters product-filters">
            <input id="productKeyword" placeholder="搜索商品、品牌、型号" />
            <select id="productBrand">
              <option value="">全部品牌</option>
            </select>
            <select id="productStatus">
              <option value="all">全部状态</option>
              <option value="shown">已上架</option>
              <option value="hidden">已下架</option>
            </select>
            <div class="muted" id="productLastImport">数据来自 digital-price-tag-generator 的官网爬虫结果</div>
          </div>
          <div class="table-scroll product-table">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th style="width: 112px;">品牌</th>
                  <th style="width: 110px;">价格</th>
                  <th style="width: 170px;">SKU / 参数</th>
                  <th style="width: 112px;">来源</th>
                  <th style="width: 96px;">状态</th>
                  <th style="width: 98px;">操作</th>
                </tr>
              </thead>
              <tbody id="productsBody"></tbody>
            </table>
          </div>
        </section>

        <section class="grid lottery-only">
          <div class="stack">
            <section class="panel">
              <div class="panel-head">
                <h2 class="panel-title">开奖记录</h2>
                <div class="panel-actions"><span id="lastUpdated" class="badge blue">--</span></div>
              </div>
              <div class="filters">
                <input id="recordKeyword" placeholder="搜索用户或奖品" />
                <select id="recordResult">
                  <option value="all">全部结果</option>
                  <option value="won">中奖</option>
                  <option value="miss">未中</option>
                </select>
                <div class="muted">按服务端开奖时间倒序展示</div>
              </div>
              <div class="redeem-box">
                <input id="redeemCodeInput" placeholder="输入用户兑换码" maxlength="32" />
                <input id="redeemNoteInput" placeholder="核销备注，可选" maxlength="120" />
                <button id="redeemBtn" class="primary" type="button">核销</button>
              </div>
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 170px;">时间</th>
                      <th style="width: 150px;">用户</th>
                      <th style="width: 150px;">奖品</th>
                      <th style="width: 90px;">结果</th>
                      <th style="width: 126px;">兑换</th>
                      <th style="width: 110px;">发放</th>
                      <th style="width: 310px;">操作</th>
                    </tr>
                  </thead>
                  <tbody id="recordsBody"></tbody>
                </table>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h2 class="panel-title">用户参与</h2>
                <span id="userTableCount" class="badge blue">--</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th style="width: 92px;">任务</th>
                    <th style="width: 100px;">剩余次数</th>
                    <th style="width: 92px;">开奖</th>
                    <th style="width: 170px;">更新时间</th>
                  </tr>
                </thead>
                <tbody id="usersBody"></tbody>
              </table>
            </section>
          </div>

          <aside id="configArea" class="stack">
            <section id="configPanel" class="panel">
              <div class="panel-head">
                <h2 class="panel-title">活动配置</h2>
                <div class="panel-actions">
                  <span id="saveState" class="save-state">未修改</span>
                  <button id="saveConfigBtn" class="primary" type="button">保存</button>
                </div>
              </div>
              <div class="activity-form">
                <div class="field">
                  <label for="activityName">活动名称</label>
                  <input id="activityName" maxlength="40" />
                </div>
                <div class="field">
                  <label for="activityStatus">状态</label>
                  <select id="activityStatus">
                    <option value="enabled">启用</option>
                    <option value="disabled">停用</option>
                  </select>
                </div>
                <div class="field">
                  <label for="activityDailyLimit">每日上限</label>
                  <input id="activityDailyLimit" type="number" min="0" max="999" />
                </div>
                <div class="field">
                  <label for="activityGuaranteeMisses">保底未中</label>
                  <input id="activityGuaranteeMisses" type="number" min="0" max="99" />
                </div>
                <div class="field">
                  <label for="activityGuaranteePrize">保底奖品</label>
                  <select id="activityGuaranteePrize"></select>
                </div>
                <div class="field">
                  <label>生效范围</label>
                  <input value="新客抽奖接口" disabled />
                </div>
                <div class="field wide">
                  <label for="activityDesc">活动说明</label>
                  <textarea id="activityDesc" maxlength="200"></textarea>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h2 class="panel-title">奖品配置</h2>
                <span id="prizeSummary" class="badge amber">可编辑</span>
              </div>
              <table class="config-table">
                <thead>
                  <tr>
                    <th style="width: 44px;">启用</th>
                    <th>奖品</th>
                    <th style="width: 82px;">权重</th>
                    <th style="width: 86px;">中奖率</th>
                    <th style="width: 118px;">库存</th>
                    <th style="width: 126px;">规则</th>
                  </tr>
                </thead>
                <tbody id="prizesBody"></tbody>
              </table>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h2 class="panel-title">任务配置</h2>
                <span id="taskSummary" class="badge amber">可编辑</span>
              </div>
              <table class="config-table">
                <thead>
                  <tr>
                    <th style="width: 44px;">启用</th>
                    <th>任务</th>
                    <th style="width: 76px;">机会</th>
                  </tr>
                </thead>
                <tbody id="tasksBody"></tbody>
              </table>
            </section>
          </aside>
        </section>
      </section>
    </main>
    <footer style="text-align:center;padding:18px 12px;color:#98a2b3;font-size:12px;">
      技术支持：<strong style="color:#667085;">FZLSaas</strong> · 反重力人工智能工作室
    </footer>
  </div>

  <script>
    var activeSection = ${activeSectionJson};
    var state = { records: [], config: null, overview: null, products: [], productSummary: null, dirty: false };
    var els = {
      serviceDot: document.getElementById('serviceDot'),
      serviceStatus: document.getElementById('serviceStatus'),
      refreshBtn: document.getElementById('refreshBtn'),
      exportBtn: document.getElementById('exportBtn'),
      saveConfigTopBtn: document.getElementById('saveConfigTopBtn'),
      saveConfigBtn: document.getElementById('saveConfigBtn'),
      saveState: document.getElementById('saveState'),
      focusConfigBtn: document.getElementById('focusConfigBtn'),
      copyApiBtn: document.getElementById('copyApiBtn'),
      viewMiniBtn: document.getElementById('viewMiniBtn'),
      configArea: document.getElementById('configArea'),
      configPanel: document.getElementById('configPanel'),
      campaignName: document.getElementById('campaignName'),
      campaignDesc: document.getElementById('campaignDesc'),
      activityStatusBadge: document.getElementById('activityStatusBadge'),
      activityName: document.getElementById('activityName'),
      activityStatus: document.getElementById('activityStatus'),
      activityDailyLimit: document.getElementById('activityDailyLimit'),
      activityGuaranteeMisses: document.getElementById('activityGuaranteeMisses'),
      activityGuaranteePrize: document.getElementById('activityGuaranteePrize'),
      activityDesc: document.getElementById('activityDesc'),
      prizeSummary: document.getElementById('prizeSummary'),
      taskSummary: document.getElementById('taskSummary'),
      userCount: document.getElementById('userCount'),
      totalChances: document.getElementById('totalChances'),
      totalRecords: document.getElementById('totalRecords'),
      wonRecords: document.getElementById('wonRecords'),
      winRate: document.getElementById('winRate'),
      lastUpdated: document.getElementById('lastUpdated'),
      userTableCount: document.getElementById('userTableCount'),
      recordKeyword: document.getElementById('recordKeyword'),
      recordResult: document.getElementById('recordResult'),
      redeemCodeInput: document.getElementById('redeemCodeInput'),
      redeemNoteInput: document.getElementById('redeemNoteInput'),
      redeemBtn: document.getElementById('redeemBtn'),
      importProductsBtn: document.getElementById('importProductsBtn'),
      refreshProductsBtn: document.getElementById('refreshProductsBtn'),
      productImportState: document.getElementById('productImportState'),
      productTotal: document.getElementById('productTotal'),
      productShownCount: document.getElementById('productShownCount'),
      productBrandCount: document.getElementById('productBrandCount'),
      productPendingPriceCount: document.getElementById('productPendingPriceCount'),
      productKeyword: document.getElementById('productKeyword'),
      productBrand: document.getElementById('productBrand'),
      productStatus: document.getElementById('productStatus'),
      productLastImport: document.getElementById('productLastImport'),
      productsBody: document.getElementById('productsBody'),
      recordsBody: document.getElementById('recordsBody'),
      usersBody: document.getElementById('usersBody'),
      prizesBody: document.getElementById('prizesBody'),
      tasksBody: document.getElementById('tasksBody')
    };

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
      if (!value) return '--';
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('zh-CN', { hour12: false });
    }

    function renderEmpty(target, text, colSpan) {
      target.innerHTML = '<tr><td class="empty" colspan="' + colSpan + '">' + escapeHtml(text) + '</td></tr>';
    }

    function setSaveState(text, tone) {
      els.saveState.textContent = text;
      els.saveState.style.color = tone === 'danger' ? 'var(--red)' : tone === 'success' ? 'var(--green)' : 'var(--muted)';
    }

    function markDirty() {
      state.dirty = true;
      setSaveState('有未保存修改', 'muted');
    }

    function on(element, eventName, handler) {
      if (element) element.addEventListener(eventName, handler);
    }

    function renderMetrics(data) {
      var totals = data.totals || {};
      var totalRecords = Number(totals.totalRecords || 0);
      var wonRecords = Number(totals.wonRecords || 0);
      els.userCount.textContent = totals.userCount || 0;
      els.totalChances.textContent = totals.totalChances || 0;
      els.totalRecords.textContent = totalRecords;
      els.wonRecords.textContent = wonRecords + ' 条';
      els.winRate.textContent = totalRecords ? Math.round(wonRecords / totalRecords * 100) + '%' : '0%';
      els.lastUpdated.textContent = formatDate(data.updatedAt);
      els.userTableCount.textContent = (data.users || []).length + ' 人';
    }

    function renderCampaign(activity) {
      var enabled = activity && activity.status !== 'disabled';
      els.campaignName.textContent = activity && activity.name ? activity.name : '新客首登抽奖';
      els.campaignDesc.textContent = activity && activity.desc ? activity.desc : '面向新用户的拉新活动。';
      els.activityStatusBadge.textContent = enabled ? '运行中' : '已停用';
      els.activityStatusBadge.className = 'badge ' + (enabled ? 'green' : 'red');
    }

    function renderRecords() {
      var keyword = els.recordKeyword.value.trim().toLowerCase();
      var result = els.recordResult.value;
      var records = state.records.filter(function (record) {
        var hitKeyword = !keyword ||
          String(record.uid || '').toLowerCase().indexOf(keyword) !== -1 ||
          String(record.name || '').toLowerCase().indexOf(keyword) !== -1;
        var hitResult = result === 'all' || (result === 'won' && record.won) || (result === 'miss' && !record.won);
        return hitKeyword && hitResult;
      });

      if (!records.length) {
        renderEmpty(els.recordsBody, '暂无开奖记录', 7);
        return;
      }

      els.recordsBody.innerHTML = records.map(function (record) {
        var fulfillment = record.fulfillment || {};
        var status = fulfillment.status || (record.won ? 'pending' : 'none');
        var statusTextMap = {
          none: '无需发放',
          pending: '待发放',
          fulfilled: '已发放',
          void: '已作废'
        };
        var statusClassMap = {
          none: 'gray',
          pending: 'amber',
          fulfilled: 'green',
          void: 'red'
        };
        var redeemStatus = record.redeemStatus || (record.won ? 'pending' : 'none');
        var redeemTextMap = {
          none: '无需兑换',
          pending: '待核销',
          redeemed: '已核销',
          expired: '已过期',
          void: '已作废'
        };
        var redeemClassMap = {
          none: 'gray',
          pending: 'amber',
          redeemed: 'green',
          expired: 'red',
          void: 'red'
        };
        var redeemCell = record.won
          ? '<span class="badge ' + (redeemClassMap[redeemStatus] || 'gray') + '">' + escapeHtml(redeemTextMap[redeemStatus] || redeemStatus) + '</span>' +
            '<div class="redeem-code">' + escapeHtml(record.redeemCode || '--') + '</div>'
          : '<span class="badge gray">无需兑换</span>';
        var actions = record.won
          ? '<div class="record-actions" data-record-id="' + escapeHtml(record.id) + '">' +
              '<select data-record-id="' + escapeHtml(record.id) + '" data-field="fulfillmentStatus">' +
                '<option value="pending" ' + (status === 'pending' ? 'selected' : '') + '>待发放</option>' +
                '<option value="fulfilled" ' + (status === 'fulfilled' ? 'selected' : '') + '>已发放</option>' +
                '<option value="void" ' + (status === 'void' ? 'selected' : '') + '>作废</option>' +
              '</select>' +
              '<input data-record-id="' + escapeHtml(record.id) + '" data-field="fulfillmentNote" maxlength="120" placeholder="发放备注" value="' + escapeHtml(fulfillment.note || '') + '" />' +
              '<button data-record-id="' + escapeHtml(record.id) + '" data-action="saveFulfillment" type="button">保存</button>' +
            '</div>'
          : '<span class="muted">未中奖记录不需要发放</span>';

        return '<tr>' +
          '<td>' + escapeHtml(formatDate(record.createdAt)) + '</td>' +
          '<td class="mono">' + escapeHtml(record.uid) + '</td>' +
          '<td>' + escapeHtml(record.name) + '<div class="muted">' + escapeHtml(record.tag || '') + '</div></td>' +
          '<td><span class="badge ' + (record.won ? 'green' : 'red') + '">' + (record.won ? '中奖' : '未中') + '</span></td>' +
          '<td>' + redeemCell + '</td>' +
          '<td><span class="badge ' + (statusClassMap[status] || 'gray') + '">' + escapeHtml(statusTextMap[status] || status) + '</span></td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join('');
    }

    function renderUsers(users) {
      if (!users.length) {
        renderEmpty(els.usersBody, '暂无用户状态', 5);
        return;
      }

      els.usersBody.innerHTML = users.map(function (user) {
        return '<tr>' +
          '<td class="mono">' + escapeHtml(user.uid) + '</td>' +
          '<td>' + escapeHtml(user.doneTaskCount) + '/' + escapeHtml(user.taskCount) + '</td>' +
          '<td>' + escapeHtml(user.chances) + '</td>' +
          '<td>' + escapeHtml(user.recordCount) + '</td>' +
          '<td>' + escapeHtml(formatDate(user.updatedAt)) + '</td>' +
          '</tr>';
      }).join('');
    }

    function renderProductSummary(summary) {
      summary = summary || {};
      var brands = summary.brandList || [];
      els.productTotal.textContent = summary.total || 0;
      els.productShownCount.textContent = summary.shownCount || 0;
      els.productBrandCount.textContent = brands.length || 0;
      els.productPendingPriceCount.textContent = summary.pendingPriceCount || 0;
      renderProductBrandOptions(brands);
      if (summary.lastImport && summary.lastImport.importedAt) {
        els.productLastImport.textContent = '最近导入：' + formatDate(summary.lastImport.importedAt) + '，新增 ' + (summary.lastImport.createdCount || 0) + '，更新 ' + (summary.lastImport.updatedCount || 0);
        els.productImportState.textContent = '已同步';
        els.productImportState.style.color = 'var(--green)';
      } else {
        els.productLastImport.textContent = '数据来自 digital-price-tag-generator 的官网爬虫结果';
        els.productImportState.textContent = '未导入';
        els.productImportState.style.color = 'var(--muted)';
      }
    }

    function renderProductBrandOptions(brands) {
      var current = els.productBrand.value;
      els.productBrand.innerHTML = '<option value="">全部品牌</option>' + brands.map(function (brand) {
        return '<option value="' + escapeHtml(brand) + '">' + escapeHtml(brand) + '</option>';
      }).join('');
      if (brands.indexOf(current) !== -1) els.productBrand.value = current;
    }

    function renderProducts() {
      var products = filterProducts();
      if (!products.length) {
        renderEmpty(els.productsBody, state.products.length ? '没有符合筛选条件的商品' : '暂无商品，点击“一键导入并上架”从爬虫数据生成商品库', 7);
        return;
      }

      els.productsBody.innerHTML = products.map(function (product) {
        var params = (product.paramsList || []).slice(0, 3).map(function (item) {
          return item.name + '：' + item.value;
        }).join(' / ');
        var tags = []
          .concat(product.isHot ? ['热门'] : [])
          .concat(product.isBest ? ['推荐'] : [])
          .concat(product.isNew ? ['新品'] : [])
          .concat((product.colors || []).slice(0, 2));
        var skuCount = (product.skuPrices || product.attrs || []).length;
        var sourceLabel = product.source === 'dji' ? 'DJI 官网' : '品牌官网';
        var statusClass = product.isShow ? 'green' : 'gray';
        var statusText = product.isShow ? '已上架' : '已下架';
        var thumb = product.image
          ? '<img src="' + escapeHtml(product.image) + '" alt="" />'
          : escapeHtml((product.brand || product.storeName || '商').slice(0, 2));

        return '<tr>' +
          '<td><div class="product-cell">' +
            '<div class="product-thumb">' + thumb + '</div>' +
            '<div>' +
              '<div class="product-name">' + escapeHtml(product.storeName || '--') + '</div>' +
              '<div class="product-info">' + escapeHtml(product.storeInfo || product.description || '--') + '</div>' +
              '<div class="product-mini-tags">' + tags.slice(0, 4).map(function (tag) { return '<span class="mini-tag">' + escapeHtml(tag) + '</span>'; }).join('') + '</div>' +
            '</div>' +
          '</div></td>' +
          '<td>' + escapeHtml(product.brand || '--') + '<div class="muted">' + escapeHtml(product.model || '') + '</div></td>' +
          '<td><strong>' + escapeHtml(product.priceText || '--') + '</strong><div class="muted">' + escapeHtml(product.unitName || '台') + '</div></td>' +
          '<td><div class="sku-line"><span>' + escapeHtml(skuCount) + ' 个 SKU</span><span>' + escapeHtml((product.paramsList || []).length) + ' 项参数</span><span>' + escapeHtml(params || '暂无参数') + '</span></div></td>' +
          '<td><span class="badge blue">' + escapeHtml(sourceLabel) + '</span><div class="muted">' + escapeHtml(formatDate(product.scrapedAt)) + '</div></td>' +
          '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
          '<td><button data-product-id="' + escapeHtml(product.id) + '" data-action="toggleProductShow" data-next-show="' + (product.isShow ? 'false' : 'true') + '" type="button">' + (product.isShow ? '下架' : '上架') + '</button></td>' +
          '</tr>';
      }).join('');
    }

    function filterProducts() {
      var keyword = els.productKeyword.value.trim().toLowerCase();
      var brand = els.productBrand.value;
      var status = els.productStatus.value;
      return (state.products || []).filter(function (product) {
        if (brand && product.brand !== brand) return false;
        if (status === 'shown' && !product.isShow) return false;
        if (status === 'hidden' && product.isShow) return false;
        if (!keyword) return true;
        return [
          product.storeName,
          product.storeInfo,
          product.brand,
          product.model,
          product.keyword,
          product.source
        ].join(' ').toLowerCase().indexOf(keyword) !== -1;
      });
    }

    function buildProbabilityMap(prizes) {
      var active = prizes.filter(function (prize) {
        return prize.enabled && Number(prize.weight || 0) > 0 && (prize.stock == null || Number(prize.stock) > 0);
      });
      var total = active.reduce(function (sum, prize) {
        return sum + Number(prize.weight || 0);
      }, 0);
      var map = {};
      prizes.forEach(function (prize) {
        var available = prize.enabled && Number(prize.weight || 0) > 0 && (prize.stock == null || Number(prize.stock) > 0);
        map[prize.id] = total && available ? prize.weight / total * 100 : 0;
      });
      return map;
    }

    function formatPercent(value) {
      var number = Number(value || 0);
      return number > 0 ? number.toFixed(number < 1 ? 2 : 1) + '%' : '0%';
    }

    function renderGuaranteePrizeOptions(prizes, selectedId) {
      els.activityGuaranteePrize.innerHTML = prizes.map(function (prize) {
        return '<option value="' + escapeHtml(prize.id) + '" ' + (prize.id === selectedId ? 'selected' : '') + '>' +
          escapeHtml(prize.name) +
          '</option>';
      }).join('');
    }

    function renderPrizeRows(prizes) {
      if (!prizes.length) {
        renderEmpty(els.prizesBody, '暂无奖品配置', 6);
        return;
      }

      var probabilityMap = buildProbabilityMap(prizes);
      els.prizesBody.innerHTML = prizes.map(function (prize) {
        var unlimited = prize.stock == null;
        var drawCount = state.overview && state.overview.prizes
          ? (state.overview.prizes.find(function (item) { return item.id === prize.id; }) || {}).drawCount || 0
          : 0;
        return '<tr>' +
          '<td><input data-prize-id="' + escapeHtml(prize.id) + '" data-field="enabled" type="checkbox" ' + (prize.enabled ? 'checked' : '') + ' /></td>' +
          '<td><div class="row-fields">' +
            '<input data-prize-id="' + escapeHtml(prize.id) + '" data-field="name" maxlength="30" value="' + escapeHtml(prize.name) + '" />' +
            '<input data-prize-id="' + escapeHtml(prize.id) + '" data-field="tag" maxlength="30" value="' + escapeHtml(prize.tag) + '" />' +
            '<div class="muted">轮盘位 ' + escapeHtml(prize.wheelIndex) + ' · 已开 ' + escapeHtml(drawCount) + ' 次</div>' +
          '</div></td>' +
          '<td><input data-prize-id="' + escapeHtml(prize.id) + '" data-field="weight" type="number" min="0" max="9999" value="' + escapeHtml(prize.weight) + '" /></td>' +
          '<td><div class="probability-text">' + escapeHtml(formatPercent(probabilityMap[prize.id])) + '</div><div class="muted">按权重估算</div></td>' +
          '<td><div class="stock-field">' +
            '<input data-prize-id="' + escapeHtml(prize.id) + '" data-field="stock" type="number" min="0" max="999999" value="' + (unlimited ? '' : escapeHtml(prize.stock)) + '" ' + (unlimited ? 'disabled' : '') + ' />' +
            '<label class="inline-field"><input data-prize-id="' + escapeHtml(prize.id) + '" data-field="unlimited" type="checkbox" ' + (unlimited ? 'checked' : '') + ' />不限</label>' +
          '</div></td>' +
          '<td><div class="rule-field">' +
            '<label class="inline-field"><input data-prize-id="' + escapeHtml(prize.id) + '" data-field="oncePerUser" type="checkbox" ' + (prize.oncePerUser ? 'checked' : '') + ' />单人一次</label>' +
          '</div></td>' +
          '</tr>';
      }).join('');

      renderGuaranteePrizeOptions(prizes, state.config && state.config.activity ? state.config.activity.guaranteePrizeId : '');
      var enabledCount = prizes.filter(function (prize) { return prize.enabled; }).length;
      els.prizeSummary.textContent = enabledCount + '/' + prizes.length + ' 启用';
    }

    function renderTaskRows(tasks) {
      if (!tasks.length) {
        renderEmpty(els.tasksBody, '暂无任务配置', 3);
        return;
      }

      els.tasksBody.innerHTML = tasks.map(function (task) {
        var claimedCount = state.overview && state.overview.tasks
          ? (state.overview.tasks.find(function (item) { return item.id === task.id; }) || {}).claimedCount || 0
          : 0;
        return '<tr>' +
          '<td><input data-task-id="' + escapeHtml(task.id) + '" data-field="enabled" type="checkbox" ' + (task.enabled ? 'checked' : '') + ' /></td>' +
          '<td><div class="row-fields">' +
            '<input data-task-id="' + escapeHtml(task.id) + '" data-field="title" maxlength="40" value="' + escapeHtml(task.title) + '" />' +
            '<input data-task-id="' + escapeHtml(task.id) + '" data-field="desc" maxlength="100" value="' + escapeHtml(task.desc) + '" />' +
            '<div class="row-fields two">' +
              '<input data-task-id="' + escapeHtml(task.id) + '" data-field="action" maxlength="12" value="' + escapeHtml(task.action) + '" />' +
              '<div class="muted">已领取 ' + escapeHtml(claimedCount) + ' 次</div>' +
            '</div>' +
          '</div></td>' +
          '<td><input data-task-id="' + escapeHtml(task.id) + '" data-field="rewardChances" type="number" min="1" max="10" value="' + escapeHtml(task.rewardChances) + '" /></td>' +
          '</tr>';
      }).join('');

      var enabledCount = tasks.filter(function (task) { return task.enabled; }).length;
      els.taskSummary.textContent = enabledCount + '/' + tasks.length + ' 启用';
    }

    function renderConfig(config) {
      state.config = JSON.parse(JSON.stringify(config));
      els.activityName.value = config.activity.name || '';
      els.activityStatus.value = config.activity.status || 'enabled';
      els.activityDailyLimit.value = config.activity.dailyLimit || 0;
      els.activityGuaranteeMisses.value = config.activity.guaranteeMisses || 0;
      els.activityDesc.value = config.activity.desc || '';
      renderCampaign(config.activity);
      renderPrizeRows(config.prizes || []);
      renderTaskRows(config.tasks || []);
      state.dirty = false;
      setSaveState('已同步', 'success');
    }

    function render(data) {
      state.overview = data;
      state.records = data.latestRecords || [];
      els.serviceStatus.textContent = '在线';
      els.serviceDot.style.background = 'var(--green)';
      renderMetrics(data);
      renderCampaign(data.activity || {});
      renderRecords();
      renderUsers(data.users || []);
      if (!state.config) {
        renderPrizeRows(data.prizes || []);
        renderTaskRows(data.tasks || []);
      }
    }

    function collectConfig() {
      var config = JSON.parse(JSON.stringify(state.config || { activity: {}, tasks: [], prizes: [] }));
      config.activity = {
        name: els.activityName.value.trim(),
        status: els.activityStatus.value,
        desc: els.activityDesc.value.trim(),
        dailyLimit: Number(els.activityDailyLimit.value || 0),
        guaranteeMisses: Number(els.activityGuaranteeMisses.value || 0),
        guaranteePrizeId: els.activityGuaranteePrize.value
      };

      config.tasks = (config.tasks || []).map(function (task) {
        return {
          id: task.id,
          title: document.querySelector('[data-task-id="' + task.id + '"][data-field="title"]').value.trim(),
          desc: document.querySelector('[data-task-id="' + task.id + '"][data-field="desc"]').value.trim(),
          action: document.querySelector('[data-task-id="' + task.id + '"][data-field="action"]').value.trim(),
          enabled: document.querySelector('[data-task-id="' + task.id + '"][data-field="enabled"]').checked,
          rewardChances: Number(document.querySelector('[data-task-id="' + task.id + '"][data-field="rewardChances"]').value || 1)
        };
      });

      config.prizes = (config.prizes || []).map(function (prize) {
        var unlimited = document.querySelector('[data-prize-id="' + prize.id + '"][data-field="unlimited"]').checked;
        var stockInput = document.querySelector('[data-prize-id="' + prize.id + '"][data-field="stock"]');
        return {
          id: prize.id,
          name: document.querySelector('[data-prize-id="' + prize.id + '"][data-field="name"]').value.trim(),
          tag: document.querySelector('[data-prize-id="' + prize.id + '"][data-field="tag"]').value.trim(),
          weight: Number(document.querySelector('[data-prize-id="' + prize.id + '"][data-field="weight"]').value || 0),
          enabled: document.querySelector('[data-prize-id="' + prize.id + '"][data-field="enabled"]').checked,
          stock: unlimited ? null : Number(stockInput.value || 0),
          oncePerUser: document.querySelector('[data-prize-id="' + prize.id + '"][data-field="oncePerUser"]').checked
        };
      });

      return config;
    }

    function loadOverview() {
      els.serviceStatus.textContent = '连接中';
      els.serviceDot.style.background = 'var(--amber)';
      return fetch('/api/admin/newcomer-lottery/overview')
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '加载失败');
          render(payload.data);
        })
        .catch(function (error) {
          els.serviceStatus.textContent = '异常';
          els.serviceDot.style.background = 'var(--red)';
          renderEmpty(els.recordsBody, error.message || '加载失败', 7);
        });
    }

    function loadProducts() {
      return fetch('/api/admin/products')
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '商品加载失败');
          els.serviceStatus.textContent = '在线';
          els.serviceDot.style.background = 'var(--green)';
          state.products = payload.data.list || [];
          state.productSummary = payload.data.summary || {};
          renderProductSummary(state.productSummary);
          renderProducts();
        })
        .catch(function (error) {
          els.serviceStatus.textContent = '异常';
          els.serviceDot.style.background = 'var(--red)';
          els.productImportState.textContent = error.message || '商品加载失败';
          els.productImportState.style.color = 'var(--red)';
          renderEmpty(els.productsBody, error.message || '商品加载失败', 7);
        });
    }

    function loadConfig() {
      return fetch('/api/admin/newcomer-lottery/config')
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '配置加载失败');
          renderConfig(payload.data);
        })
        .catch(function (error) {
          setSaveState(error.message || '配置加载失败', 'danger');
          renderEmpty(els.prizesBody, error.message || '配置加载失败', 6);
          renderEmpty(els.tasksBody, error.message || '配置加载失败', 3);
        });
    }

    function load() {
      if (activeSection === 'products') return loadProducts();
      return loadOverview().then(loadConfig);
    }

    function saveConfig() {
      if (!state.config) return;
      var payload = collectConfig();
      els.saveConfigBtn.disabled = true;
      els.saveConfigTopBtn.disabled = true;
      setSaveState('保存中...', 'muted');

      fetch('/api/admin/newcomer-lottery/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          if (result.status !== 200) throw new Error(result.msg || '保存失败');
          renderConfig(result.data);
          return loadOverview();
        })
        .then(function () {
          setSaveState('保存成功', 'success');
        })
        .catch(function (error) {
          setSaveState(error.message || '保存失败', 'danger');
        })
        .finally(function () {
          els.saveConfigBtn.disabled = false;
          els.saveConfigTopBtn.disabled = false;
        });
    }

    function copyApiAddress() {
      var url = window.location.origin + '/api/newcomer-lottery/state';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          setSaveState('接口地址已复制', 'success');
        }).catch(function () {
          setSaveState(url, 'muted');
        });
        return;
      }
      setSaveState(url, 'muted');
    }

    function saveFulfillment(recordId) {
      var status = document.querySelector('[data-record-id="' + recordId + '"][data-field="fulfillmentStatus"]').value;
      var note = document.querySelector('[data-record-id="' + recordId + '"][data-field="fulfillmentNote"]').value.trim();
      var button = document.querySelector('[data-record-id="' + recordId + '"][data-action="saveFulfillment"]');
      if (button) {
        button.disabled = true;
        button.textContent = '保存中';
      }

      fetch('/api/admin/newcomer-lottery/records/' + encodeURIComponent(recordId) + '/fulfillment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status, note: note })
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '发放状态保存失败');
          setSaveState('发放状态已更新', 'success');
          return loadOverview();
        })
        .catch(function (error) {
          setSaveState(error.message || '发放状态保存失败', 'danger');
        })
        .finally(function () {
          if (button) {
            button.disabled = false;
            button.textContent = '保存';
          }
        });
    }

    function redeemCode() {
      var code = els.redeemCodeInput.value.trim();
      var note = els.redeemNoteInput.value.trim();
      if (!code) {
        els.redeemCodeInput.focus();
        setSaveState('请输入兑换码', 'danger');
        return;
      }

      els.redeemBtn.disabled = true;
      els.redeemBtn.textContent = '核销中';
      setSaveState('正在核销兑换码...', 'muted');

      fetch('/api/admin/newcomer-lottery/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, note: note })
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '核销失败');
          els.redeemCodeInput.value = '';
          els.redeemNoteInput.value = '';
          setSaveState('核销成功', 'success');
          return loadOverview();
        })
        .catch(function (error) {
          setSaveState(error.message || '核销失败', 'danger');
        })
        .finally(function () {
          els.redeemBtn.disabled = false;
          els.redeemBtn.textContent = '核销';
        });
    }

    function importProducts() {
      els.importProductsBtn.disabled = true;
      els.importProductsBtn.textContent = '导入中';
      els.productImportState.textContent = '正在读取爬虫数据...';
      els.productImportState.style.color = 'var(--muted)';

      fetch('/api/admin/products/import-price-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShow: true })
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '导入失败');
          var data = payload.data || {};
          els.productImportState.textContent = '导入完成：新增 ' + (data.createdCount || 0) + '，更新 ' + (data.updatedCount || 0);
          els.productImportState.style.color = 'var(--green)';
          return loadProducts();
        })
        .catch(function (error) {
          els.productImportState.textContent = error.message || '导入失败';
          els.productImportState.style.color = 'var(--red)';
        })
        .finally(function () {
          els.importProductsBtn.disabled = false;
          els.importProductsBtn.textContent = '一键导入并上架';
        });
    }

    function toggleProductShow(productId, nextShow) {
      var button = document.querySelector('[data-product-id="' + productId + '"][data-action="toggleProductShow"]');
      if (button) {
        button.disabled = true;
        button.textContent = nextShow ? '上架中' : '下架中';
      }

      fetch('/api/admin/products/' + encodeURIComponent(productId) + '/show', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShow: nextShow })
      })
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          if (payload.status !== 200) throw new Error(payload.msg || '状态更新失败');
          els.productImportState.textContent = nextShow ? '商品已上架' : '商品已下架';
          els.productImportState.style.color = 'var(--green)';
          return loadProducts();
        })
        .catch(function (error) {
          els.productImportState.textContent = error.message || '状态更新失败';
          els.productImportState.style.color = 'var(--red)';
        })
        .finally(function () {
          if (button) button.disabled = false;
        });
    }

    function exportSnapshot() {
      if (!state.config) return;
      var payload = JSON.stringify({ overview: state.overview, config: collectConfig(), products: state.products }, null, 2);
      var blob = new Blob([payload], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'newcomer-lottery-admin-snapshot.json';
      link.click();
      URL.revokeObjectURL(url);
    }

    on(els.refreshBtn, 'click', load);

    if (activeSection === 'products') {
      on(els.refreshProductsBtn, 'click', loadProducts);
      on(els.importProductsBtn, 'click', importProducts);
      on(els.productKeyword, 'input', renderProducts);
      on(els.productBrand, 'change', renderProducts);
      on(els.productStatus, 'change', renderProducts);
      on(els.productsBody, 'click', function (event) {
        var target = event.target;
        if (!target || target.dataset.action !== 'toggleProductShow') return;
        toggleProductShow(target.dataset.productId, target.dataset.nextShow === 'true');
      });
    } else {
      on(els.saveConfigBtn, 'click', saveConfig);
      on(els.saveConfigTopBtn, 'click', saveConfig);
      on(els.exportBtn, 'click', exportSnapshot);
      on(els.copyApiBtn, 'click', copyApiAddress);
      on(els.redeemBtn, 'click', redeemCode);
      on(els.redeemCodeInput, 'keydown', function (event) {
        if (event.key === 'Enter') redeemCode();
      });
      on(els.viewMiniBtn, 'click', function () {
        window.open('/api/newcomer-lottery/state', '_blank');
      });
      on(els.focusConfigBtn, 'click', function () {
        els.configPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        els.activityName.focus();
      });
      on(els.configArea, 'input', markDirty);
      on(els.configArea, 'change', function (event) {
        var target = event.target;
        if (target && target.dataset && target.dataset.field === 'unlimited') {
          var stockInput = document.querySelector('[data-prize-id="' + target.dataset.prizeId + '"][data-field="stock"]');
          if (stockInput) {
            stockInput.disabled = target.checked;
            if (target.checked) stockInput.value = '';
          }
        }
        markDirty();
      });
      on(els.recordKeyword, 'input', renderRecords);
      on(els.recordResult, 'change', renderRecords);
      on(els.recordsBody, 'click', function (event) {
        var target = event.target;
        if (!target || target.dataset.action !== 'saveFulfillment') return;
        saveFulfillment(target.dataset.recordId);
      });
    }
    load();
  </script>
</body>
</html>`;
}

module.exports = { renderAdminPage };
