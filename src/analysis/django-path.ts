/** Normalize the confirmed regex subset; unsupported alternatives remain explicit. */
export function djangoPath(pattern:string){
 let value=pattern.replace(/^\^/,'').replace(/\$$/,'').replace(/\/\?$/,'').replace(/\(\?:\/\)\?$/,'');
 let result='';
 for(let i=0;i<value.length;){
  const named=value.slice(i).match(/^\(\?P<([\w]+)>/);
  if(named){let depth=1,escaped=false,inClass=false,j=i+named[0].length;for(;j<value.length;j++){const ch=value[j];if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch==='[')inClass=true;else if(ch===']')inClass=false;else if(!inClass&&ch==='(')depth++;else if(!inClass&&ch===')'&&!--depth)break;}
   if(depth)return{value:pattern,reason:'路径中的括号没有完整配对'};
   if(value[j+1]==='?')return{value:pattern,reason:'路径参数可以省略，未确定唯一写法'};
   result+='{'+named[1]+'}';i=j+1;continue;
  }
  const ch=value[i];if(ch==='\\'&&i+1<value.length&&!/[wWdDsSbBAZ0-9]/.test(value[i+1])){result+=value[i+1];i+=2;continue;}
  if(/[.()[\]|?*+^$]/.test(ch)||ch==='\\')return{value:pattern,reason:'路径含有未展开的正则分支或位置参数'};
  result+=ch;i++;
 }
 return{value:result};
}
