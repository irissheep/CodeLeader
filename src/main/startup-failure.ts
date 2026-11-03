/** Hints are based on output; the original output remains available. */
export function startupHint(output:string):string|undefined {
 if(/EADDRINUSE|address already in use|port .*already in use/i.test(output))return '端口已被占用，请检查占用程序或修改端口。';
 if(/ERR_OSSL_EVP_UNSUPPORTED|unsupported engine|requires? (?:node|python|java)|version (?:is )?(?:too old|not supported)|requires .*version/i.test(output))return '当前运行环境的版本可能与项目的构建工具不兼容。';
 if(/missing script|script .*not found/i.test(output))return '没有找到要运行的脚本，请检查启动命令。';
 if(/cannot find module|module not found|no module named|node_modules.*(?:missing|not found)|command not found|is not recognized|\bENOENT\b/i.test(output))return '没有找到所需的依赖、运行命令或目录，请检查安装情况。';
 if(/EACCES|EPERM|permission denied|access is denied/i.test(output))return '没有权限访问所需文件或端口。';
 if(/Field required \[type=missing\]/i.test(output))return '服务缺少必填配置，请检查它的启动设置。';
 return undefined;
}
