# 滚轮缩放检查

直接在项目根运行：

```powershell
npm run check:zoom-smooth -- --before
npm run check:zoom-smooth
```

脚本进程内采用与开发入口一致的D盘临时/缓存目录，不修改HOME、USERPROFILE或系统设置。启动工具自身的1564×954原生Electron窗口，使用已保存真实模型与17步历史，不运行目标服务、构建或业务命令。React使用官方profiling构建，测试bundle注入节点/边函数计数和Profiler，不把这些探针写进产品源码。

输入和输出配置在tests/fixtures/zoom-review.json。首次验证已冻结source-before、before模型、projects.json、runtime-inputs.json到本轮报告目录；复跑需保留这些归档。新环境先按corpus/README.md准备固定语料并运行corpus，再恢复本地验证归档；没有真实历史时应报告缺失，不能造一份Span代替。before不会读取当前修改后的产品文件，测试脚本则与after相同。

三个场景各跑：鼠标30格（100、60ms）；触控板200事件（100次+4、100次−4、8ms）；Ctrl+滚轮10格（100、60ms）。CDP提交真实输入，保留请求数和浏览器实际收到数。浏览器可能合并触控板事件，不能把收到数补造为200。

每组保留rAF逐帧比例、耗时、锚点、节点身份与渲染、Profiler提交、相对时间时钟标签、Layout/Paint/RasterTask跟踪。原始总提交和扣除明确时钟标签后的滚轮提交并排报告，不删除原记录。500ms时钟本来就存在，不是滚轮输入；节点函数计数用实际播放下一步校准。

补充检查包括单格展开时长、停手200/400ms文字、十次阈值往返、实际上下限继续滚。文字同时保存原生整窗和局部图，避免只看局部截图的LCD采样差异；相同矩形和字号一起核对。测试bundle在分级变更时强制读一次矩形，记录该次脚本+样式/布局工作，不把rAF间隔误当成渲染工作耗时。

验收阈值与原因在docs/ui-principles.md“交互性能预算”。after不满足帧预算、节点/提交预算、单格时间、锚点、文字恢复、回差或边界时，命令返回失败。`--extras-only`仅用于运行时定向复查，单独输出到after-zoom-focused，不代替完整九组检查。

报告生成：完成本轮corpus与check:layout后，运行 `scripts/Invoke-Project.ps1 -Task node -TaskArgs @('scripts/report-zoom-smooth.mjs')`。评分器继续使用原expected和版本，报告不反推或改写标准答案。
