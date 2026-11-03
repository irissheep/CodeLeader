# 第三方告知

源码依赖版本以 `package-lock.json` 和 Java 构建清单为准。Electron、React、React Flow、Monaco Editor、web-tree-sitter、Pyright、Tree-sitter 语法资源等分别采用其上游许可证；项目中的 Inter 和 JetBrains Mono 字体及其 OFL 原文位于 `src/renderer/fonts`。

锁文件中直接运行依赖的许可证声明为：`elkjs` 0.12.0 使用 `EPL-2.0 OR GPL-3.0-or-later`；`lucide-react` 1.59.0 使用 ISC；`@jridgewell/trace-mapping`、`@xyflow/react`、`js-yaml`、`monaco-editor`、`pyright`、`react`、`react-dom` 和 `web-tree-sitter` 声明 MIT。完整版本和间接依赖见锁文件；这些是依赖元数据，不替代逐个核对上游许可原文。

Java 分析组件的 Maven 元数据列出 JavaParser 3.27.1 的 LGPL-3.0 和 Apache-2.0、Gson 2.13.2 的 Apache-2.0，以及 Javassist 3.30.2-GA 的 MPL-1.1、LGPL-2.1 和 Apache-2.0。多许可证的适用方式和间接依赖仍须结合上游原文与实际发行材料核对；本段是依赖元数据，不是法律结论。构建时生成的许可证副本、JAR 与 Java 运行时属于发行产物，不随此源码仓库提交。

运行录制使用 OpenTelemetry Java agent 2.27.0 和 Collector Contrib 0.163.1，发行来源和 SHA-256 固定在 `runtime/dependencies.json`。Collector 的 Apache-2.0 许可证原文位于 `runtime/third-party-notices`；Java agent JAR 内含第三方许可证材料。打包时同时下载并校验 Collector 的官方 SPDX 物料清单，保存在发行包的 `resources/licenses`；其中的间接依赖仍须在发布二进制前核对其适用告知。

若分发包含 Java 运行时、Electron 或其他二进制的版本，必须同时核对并附带对应版本的许可证、第三方告知及必要的源码获取信息。源码仓库中的依赖声明本身不代表已完成某个二进制发行版本的许可审查。
