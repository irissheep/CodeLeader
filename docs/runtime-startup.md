# 运行接入与启动方式

工具先读取当前项目的 R2 应用/前端单元、构建声明和配置，给出可修改的启动方式。选择连接已启动页面时只连接用户填写的本机 URL；选择由工具启动时，必须先在「启动方式」确认命令、目录、端口和页面地址。确认按项目和源码版本绑定，只能使用一次。项目切换后的过期确认不能启动或撤销新项目的确认。

源码目录只读。启动使用 D 盘 `.tools/runtime/environments/<projectId>/source` 副本；配置存在同目录的 `startup.json`。下载、Maven/Gradle/npm/pip 缓存、Python 环境和日志使用现有 D 盘受控目录，不修改系统 HOME/USERPROFILE。工具只管理它拥有的进程，不停止端口上的任意外部进程。

检测来源包括 package.json 的 dev/start/serve、Spring Boot Maven/Gradle 声明、可运行 JAR 的 manifest、Procfile、README、Dockerfile JSON 命令、Compose command、pyproject 中可静态读取的命令、manage.py 和 .flaskenv。只读这些文件，不导入 Python 应用或执行配置来完成检测。默认端口和启动阈值的来源集中在 `src/shared/runtime-policy.json` 与既有 `http-link-policy.json`；端口不明时需要填写，不能当作已确定。

Maven 的 forked 应用通过 `spring-boot.run.jvmArguments` 接入已有外部 agent，而不是仅观察 Maven 进程。Java 观察方法使用当前项目的有限签名计划；缺语义签名时只接受明确导入、本项目定义和 Java 内置类型，不猜通配导入。Python 的根目录与文件计划来自本项目单元；同名模块还须匹配原文件。普通同步函数使用实际进入/退出；不读取任意局部变量，不消费生成器或协程。

Python 忽略地址默认是空字符串，即不按名字忽略任何地址。来源是 `runtime-policy.json` 中的 `excludedUrls.default`：保留真实业务入口，不能把 health、登录等名称当作后台规则。确认页可填写多个 SDK 支持的正则，以逗号分隔；保存在本项目启动配置，并通过 `CODELEADER_EXCLUDED_URLS` 传给 Flask/FastAPI 观察器。缺失观察库时启动器继续运行应用，不让观察失败代替业务返回。

静态资源依据浏览器类型，更新通知依据已识别的开发工具，框架端点依据实际依赖；重复 GET 依据真实无动作请求记录。没有动作或归入其他类的请求保留在「其他请求」，不抢操作焦点。业务请求不按 auth/health/status/csrf 等名字排除。链接/表单使用浏览器的导航原因和 1.5 秒动作窗口；脚本请求沿已有回调标记。该关联不宣称证明因果。重定向保留独立请求，归属同一个操作，写请求优先。

列表摘要只显示数量，包装对象使用原键名，对象显示字段数。默认真实值和原有预算不改变。Python 原样模式保留 SDK 实际产生的数据库属性；SQL 参数、行数没录到时不从 SQL 名称或模板猜值。可运行 JAR 的源码版本未证明时不将实际值映射成当前源码。

本轮真实运行只验证 Spring Boot + Maven 的服务端页面和 Flask 的服务端页面。Gradle、JAR、独立前端、Django、多进程和更复杂动态命令没有实际启动验证。自动依赖准备以 requirements.txt 为主；仅 pyproject 的依赖准备仍有限制。Gunicorn 在 Windows 下只为已确认 Flask 入口提供 Flask CLI 替代，并明确展示来源，不把它说成 Gunicorn 已运行。外部资源没有自动启动；未完成外部资源在线检查。

官方依据：

- [Spring Boot Maven 启动与 JVM 参数](https://docs.spring.io/spring-boot/maven-plugin/run.html)
- [Flask 观察器与地址排除](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/flask/flask.html)
- [Python profile 事件](https://docs.python.org/3.12/library/sys.html#sys.setprofile)
- [Python 线程 profile](https://docs.python.org/3.12/library/threading.html#threading.setprofile)
