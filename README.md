# CodeLeader

CodeLeader 是 Windows 桌面开发工具，帮助开发者从项目主干、接口导览和代码依赖进入陌生项目，并在连接真实开发页面后查看实际请求的流程和数据。当前为开发预览版。

静态分析以 Java、Python、TypeScript 和 JavaScript 为主要范围，覆盖部分 Spring、FastAPI、Flask、Django、Vue 和 React 用法。动态调用、缺失依赖及复杂框架配置可能使结果不完整；具体能力以应用中的分析结果为准。静态阅读不需要启动目标项目。

## 开发环境

- Windows x64，项目及其受控数据、缓存、临时文件需放在 D 盘。
- Node.js 24、npm、JDK 21 和 Maven 3.9。将 JDK 根目录设置为 `JAVA_HOME`，并将 Maven 的 `mvn.cmd` 加入 `PATH`；也可分别设置 `CODELEADER_JDK` 和 `CODELEADER_MAVEN`。
- 首次准备资源需要网络访问 npm 和 Maven 仓库。项目不包含已下载的 JRE、构建产物或目标项目源码。

在 D 盘的仓库目录打开 PowerShell：

```powershell
.\scripts\Invoke-Project.ps1 -Task npm -TaskArgs ci
.\scripts\Invoke-Project.ps1 -Task prepare:resources
.\scripts\Invoke-Project.ps1 -Task build
.\scripts\Invoke-Project.ps1 -Task check
.\scripts\Invoke-Project.ps1 -Task dev
```

包装脚本只为当前进程设置缓存与临时目录，不修改全局用户目录或系统环境。运行采集的 Java 组件可通过 `-Task build:runtime-java` 构建。

如需在本机生成 Windows 发行候选，可运行 `./scripts/Invoke-Project.ps1 -Task package`。该步骤会下载并校验固定版本的录制组件、构建 Java 扩展，然后在项目的 `release` 目录生成程序和 ZIP。该输出仍需经过功能与发行许可核查，不能仅凭打包成功认定为稳定版。需要启动 Python 服务时，需自行提供 Python，并通过 `CODELEADER_PYTHON` 指向其解释器；工具会为所选项目准备隔离环境。

## 真实页面与数据

阅读静态图时不会执行目标仓库的脚本。需要查看真实请求时，应连接当前项目已启动的页面与服务，或在确认启动方式后使用已配置的开发环境；工具不具备任意陌生仓库一键部署能力。

新会话默认在本机保存录到的真实请求和数据，可能包含密码、Cookie 和业务内容。界面的隐藏显示只影响展示，不等于删除或脱敏已保存的数据。请通过应用的会话管理删除不再需要的会话，并在导出或分享前检查内容。

## 检查与局限

`check` 执行 TypeScript 检查。公开语料及其固定版本列于 [公开语料说明](corpus/public/README.md)，可通过 `-Task corpus` 获取许可已核实的样本并重新分析评分。许可证未知的样本和未启用的私有样本会明确跳过；目录发现的完整评分哈希尚未核对，不能将部分验证视为通过。`check:layout`、`check:zoom-smooth`、`check:zoom-text`、`check:runtime-start`、`check:overlay-follow`、`check:orientation` 和 `check:contrast` 是可选的原有界面检查，依赖未公开的本机场景配置，有些还依赖录制历史；干净克隆不能直接运行它们，不能把缺少数据视为通过。

本项目采用 [MIT 许可证](LICENSE)。第三方软件和发行材料的许可说明见 [第三方告知](THIRD_PARTY_NOTICES.md)。

贡献者可安装 Gitleaks，并在仓库内运行 `git config --local core.hooksPath .githooks`，使提交前检查暂存内容；也可通过 `CODELEADER_GITLEAKS` 指定程序位置。钩子不会自动随克隆启用。
