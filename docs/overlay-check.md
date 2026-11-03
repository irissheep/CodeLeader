# 叠加层跟随检查

先使用项目的 D 盘入口准备语料分析和已有历史输入；不启动目标应用。检查配置在 `tests/fixtures/overlay-review.json`，只在测试固件里指定语料。输出位于配置的 output 目录，所有 Electron 数据与缓存由既有检查入口放在 D 盘。

本轮冻结输入已经保存在 `.tmp/verification-u8b-overlay-follow`：source-before 是修改前源码，before/after 是完整分析结果，runtime-inputs 是既有真实历史。不得手拼运行记录。缺少归档时，先准备语料并运行 `corpus/overlay-review.mjs --overlay-freeze`、`npm run corpus`、`corpus/overlay-review.mjs --overlay-capture-before`；此时新冻结的源码只能代表本次开始，不能冒充历史旧版。

```powershell
.\scripts\Invoke-Project.ps1 -Task npm -TaskArgs @('run','check:overlay-follow','--','--before')
.\scripts\Invoke-Project.ps1 -Task npm -TaskArgs @('run','check:overlay-follow')
```

1564×954 原生 Electron 窗口中，使用 Playwright `page.mouse.wheel` 到达实际五档比例，使用 mouse down/move/up 拖拽；不调用视口设置接口。每个端点从真实 SVG 的 getScreenCTM 得到屏幕坐标，与卡片右缘/目标左强调条中点的矩形核对。截图、原始十组矩形、连续十帧、全部可见模块悬停、提示命中和标题重叠保存在 RESULT.json / ENDPOINTS.md。

验收允许线在块下层。本实现用同一流坐标中的遮罩遮住块：因此原始路径与文字可能有几何交点，实际可见的线/光点不穿字；两种计数均保留。远景收成药丸/圆点时原模块隐藏，JSON 明确记录 lineVisible/blockVisible，不能将隐藏截图当作可见对齐证据。

`--layers-only` 只核对接口、依赖与保存历史的坐标层，方便失败后定向复测；默认完整检查也包含这三种状态。图内步骤与运行光点仍使用原有回放逻辑。跨原生页面的点击回声经进程通信，镜头运动时关闭旧的目标轨迹，当前检查未启动真实业务页面，不能声称它的跨进程显示延迟已逐帧验证。

U8 回归使用 `check:zoom-smooth -- --review-config=tests/fixtures/overlay-review.json`，参数和预算不变。支持 `--scenario`、`--sequence`、`--run-suffix` 定向复测并单独保存；原失败输入必须保留，额外输入不可从原记录删除。全量版式检查仍用 `check:layout -- --review-config=tests/fixtures/overlay-review.json`。
