package local.codeleader;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.*;
import io.opentelemetry.context.Scope;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.lang.reflect.*;
import java.io.*;

public final class ValueHelper {
  static final Properties PLAN=new Properties();
  static final Set<String> RAW=Set.of("question","answer","mode","id","userId","user_id","noteId","note_id","revision","count","indexed","reason");
  static final ConcurrentHashMap<String,AtomicInteger> COUNTS=new ConcurrentHashMap<>();
  static final ThreadLocal<Call> STACK=new ThreadLocal<>();
  static final String PROCESS=ProcessHandle.current().pid()+":"+UUID.randomUUID();
  static {try(var in=new FileInputStream(System.getenv("CODELEADER_PLAN"))){PLAN.load(in);}catch(Exception ignored){}}
  public static class Call { public Span span; public Scope scope; public long started; public Call previous; }
  public static Call enter(Method method,Object[] args){
    if(!Span.current().getSpanContext().isValid())return null;
    String trace=Span.current().getSpanContext().getTraceId();
    if(COUNTS.size()>1024)COUNTS.clear();
    int count=COUNTS.computeIfAbsent(trace,k->new AtomicInteger()).incrementAndGet();
    if(count>300){Span.current().setAttribute("codeleader.dropped",count-300);return null;}
    String key=method.getDeclaringClass().getName()+"#"+method.getName()+"("+String.join(",",Arrays.stream(method.getParameterTypes()).map(Class::getTypeName).toList())+")";
    String id=PLAN.getProperty("method."+key);if(id==null)return null;
    Call call=new Call();call.started=System.nanoTime();call.previous=STACK.get();String parent=Span.current().getSpanContext().getSpanId();
    try {
      call.span=GlobalOpenTelemetry.getTracer("codeleader.values","1").spanBuilder(method.getDeclaringClass().getSimpleName()+"."+method.getName()).startSpan();
      call.scope=call.span.makeCurrent();
      call.span.setAttribute("codeleader.point",id).setAttribute("codeleader.version",PLAN.getProperty("version","")).setAttribute("codeleader.invocation",call.span.getSpanContext().getSpanId());
      call.span.setAttribute("codeleader.process",PROCESS).setAttribute("codeleader.clock",PROCESS).setAttribute("codeleader.thread",Thread.currentThread().getId());
      if(call.previous!=null&&call.previous.span.getSpanContext().getTraceId().equals(trace))call.span.setAttribute("codeleader.sync_parent",call.previous.span.getSpanContext().getSpanId());
      STACK.set(call);
      String[] names=PLAN.getProperty("names."+id,"").split(",");StringBuilder json=new StringBuilder("{");
      if("raw".equals(PLAN.getProperty("policy"))){Map<String,Object> input=new LinkedHashMap<>();for(int i=0;i<args.length;i++)input.put(i<names.length&&!names[i].isEmpty()?names[i]:"arg"+i,args[i]);String captured=actual(input);call.span.setAttribute("codeleader.input",captured);Span event=GlobalOpenTelemetry.getTracer("codeleader.values","2").spanBuilder(method.getDeclaringClass().getSimpleName()+"."+method.getName()).startSpan();event.setAttribute("codeleader.phase","enter").setAttribute("codeleader.invocation",call.span.getSpanContext().getSpanId()).setAttribute("codeleader.parent",parent).setAttribute("codeleader.point",id).setAttribute("codeleader.version",PLAN.getProperty("version","")).setAttribute("codeleader.input",captured).setAttribute("codeleader.process",PROCESS).setAttribute("codeleader.clock",PROCESS).setAttribute("codeleader.thread",Thread.currentThread().getId());if(call.previous!=null)event.setAttribute("codeleader.sync_parent",call.previous.span.getSpanContext().getSpanId());event.end();return call;}
      for(int i=0;i<args.length;i++){if(i>0)json.append(',');String name=i<names.length&&!names[i].isEmpty()?names[i]:"arg"+i;json.append(quote(name)).append(':').append(safe(args[i],name,0));}
      json.append('}');call.span.setAttribute("codeleader.input",bound(json.toString()));return call;
    }catch(Throwable ignored){STACK.set(call.previous);if(call.scope!=null)call.scope.close();if(call.span!=null){call.span.setAttribute("codeleader.capture.error",true);call.span.end();}return null;}
  }
  public static void exit(Call call,Object result,Throwable error){if(call==null)return;
    try{if(error!=null){call.span.setStatus(StatusCode.ERROR);call.span.setAttribute("codeleader.error","raw".equals(PLAN.getProperty("policy"))?actual(exception(error,Collections.newSetFromMap(new IdentityHashMap<>()),0)):"{\"type\":"+quote(error.getClass().getName())+"}");}
      else call.span.setAttribute("codeleader.output","raw".equals(PLAN.getProperty("policy"))?actual(result):bound(safe(result,"result",0)));
    }catch(Throwable ignored){call.span.setAttribute("codeleader.capture.error",true);}finally{try{STACK.set(call.previous);call.span.setAttribute("codeleader.phase","exit").setAttribute("codeleader.duration_ms",(System.nanoTime()-call.started)/1000000.0);call.scope.close();}finally{call.span.end();}}
  }
  // Standard Throwable accessors only; never invoke a business override or inspect locals.
  public static Map<String,Object> exception(Throwable error,Set<Throwable> seen,int depth){
    Map<String,Object> value=new LinkedHashMap<>();value.put("type",error.getClass().getName());
    if(!seen.add(error)){value.put("causeNotice","原因重复，已停止展开");return value;}
    try{if(error.getClass().getMethod("getMessage").getDeclaringClass()==Throwable.class)value.put("message",error.getMessage());else value.put("messageNotice","没有保存异常消息");}catch(Throwable ignored){value.put("messageNotice","没有保存异常消息");}
    try{if(error.getClass().getMethod("getStackTrace").getDeclaringClass()==Throwable.class){
      StackTraceElement[] frames=error.getStackTrace();List<Map<String,Object>> saved=new ArrayList<>();
      for(int i=0;i<Math.min(frames.length,24);i++){StackTraceElement f=frames[i];Map<String,Object> frame=new LinkedHashMap<>();frame.put("className",f.getClassName());frame.put("method",f.getMethodName());frame.put("file",f.getFileName());frame.put("line",f.getLineNumber());saved.add(frame);}value.put("stack",saved);if(frames.length>24)value.put("stackOriginalLength",frames.length);
    }}catch(Throwable ignored){}
    try{if(error.getClass().getMethod("getCause").getDeclaringClass()==Throwable.class){Throwable cause=error.getCause();if(cause==null)value.put("cause",null);else if(depth<2)value.put("cause",exception(cause,seen,depth+1));else value.put("causeNotice","还有后续原因，未继续保存");}else value.put("causeNotice","没有保存后续原因");}catch(Throwable ignored){value.put("causeNotice","没有保存后续原因");}
    return value;
  }
  static String bound(String json){return json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>12000?"{\"truncated\":true,\"reason\":\"snapshot budget\"}":json;}
  static String quote(String s){StringBuilder out=new StringBuilder("\"");for(int i=0;i<Math.min(s.length(),640);i++){char c=s.charAt(i);if(c=='"'||c=='\\')out.append('\\').append(c);else if(c<' ')out.append(String.format("\\u%04x",(int)c));else out.append(c);}return out.append('"').toString();}
  static String jsonString(String s){StringBuilder out=new StringBuilder("\"");for(int i=0;i<s.length();i++){char c=s.charAt(i);if(c=='"'||c=='\\')out.append('\\').append(c);else if(c<' ')out.append(String.format("\\u%04x",(int)c));else out.append(c);}return out.append('"').toString();}
  static void limited(List<String> limits,String path,String reason,Integer length,int saved){if(limits.size()<64)limits.add("{\"path\":"+jsonString(path.substring(0,Math.min(path.length(),512)))+",\"reason\":"+jsonString(reason)+(length==null?"":",\"originalLength\":"+length)+",\"saved\":"+saved+"}");}
  public static String actual(Object v){return actual(v,new ArrayList<>());}
  public static String actual(Object v,List<String> supplied){List<String> limits=new ArrayList<>(supplied);String value=raw(v,"",0,new IdentityHashMap<>(),limits,new int[]{0}),result="{\"__codeleader_snapshot\":2,\"value\":"+value+",\"limits\":["+String.join(",",limits)+"]}";int size=result.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;return size<=65536?result:"{\"__codeleader_snapshot\":2,\"value\":null,\"limits\":[{\"path\":\"\",\"reason\":\"快照字节预算\",\"originalLength\":"+size+",\"saved\":0,\"unit\":\"字节\"}]}";}
  static String raw(Object v,String path,int depth,IdentityHashMap<Object,Boolean> seen,List<String> limits,int[] budget){
    if(v==null)return "null";if(budget[0]>50000){limited(limits,path,"字节预算",null,0);return "null";}budget[0]+=16;
    if(v instanceof Boolean||v instanceof Byte||v instanceof Short||v instanceof Integer||v instanceof Long)return String.valueOf(v);
    if(v instanceof Float f)return Float.isFinite(f)?String.valueOf(f):"null";if(v instanceof Double d)return Double.isFinite(d)?String.valueOf(d):"null";
    if(v instanceof String s){int count=Math.min(s.length(),8192);budget[0]+=count*3;if(count<s.length())limited(limits,path,"字符串预算",s.length(),count);return jsonString(s.substring(0,count));}
    if(depth>=6){limited(limits,path,"深度预算",null,0);return "null";}if(seen.put(v,true)!=null){limited(limits,path,"循环引用",null,0);return "null";}
    try {
      Class<?> type=v.getClass();String name=type.getName();
      if(type.isArray()){int size=Array.getLength(v),count=Math.min(size,50);if(count<size)limited(limits,path,"数组预算",size,count);List<String> values=new ArrayList<>();for(int i=0;i<count;i++)values.add(raw(Array.get(v,i),path+"["+i+"]",depth+1,seen,limits,budget));return "["+String.join(",",values)+"]";}
      if(v instanceof List<?> list&&name.startsWith("java.util.")){int count=Math.min(list.size(),50);if(count<list.size())limited(limits,path,"数组预算",list.size(),count);List<String> values=new ArrayList<>();for(int i=0;i<count;i++)values.add(raw(list.get(i),path+"["+i+"]",depth+1,seen,limits,budget));return "["+String.join(",",values)+"]";}
      if(v instanceof Map<?,?> map&&name.startsWith("java.util.")){List<String> values=new ArrayList<>();int examined=0;for(var e:map.entrySet()){if(examined++>=64)break;if(e.getKey() instanceof String key){if(key.length()>256){limited(limits,path,"字段名预算",key.length(),0);continue;}budget[0]+=key.length()*6;values.add(jsonString(key)+":"+raw(e.getValue(),path.isEmpty()?key:path+"."+key,depth+1,seen,limits,budget));}}if(values.size()<map.size())limited(limits,path,"字段预算",map.size(),values.size());return "{"+String.join(",",values)+"}";}
      // Fixed Spring body field, never arbitrary bean getters or serializers.
      if(name.equals("org.springframework.http.ResponseEntity")||name.equals("org.springframework.http.HttpEntity")){Class<?> owner=type;while(owner!=null&&!owner.getName().equals("org.springframework.http.HttpEntity"))owner=owner.getSuperclass();if(owner!=null){Field field=owner.getDeclaredField("body");if(field.trySetAccessible())return raw(field.get(v),path,depth+1,seen,limits,budget);}}
      if(Arrays.asList(PLAN.getProperty("dtos","").split(",")).contains(name)){List<String> values=new ArrayList<>();for(Field f:type.getDeclaredFields()){if(Modifier.isStatic(f.getModifiers())||f.isSynthetic())continue;if(values.size()>=64){limited(limits,path,"字段预算",null,values.size());break;}String p=path.isEmpty()?f.getName():path+"."+f.getName();if(!f.trySetAccessible()){limited(limits,p,"字段不可访问",null,0);continue;}try{values.add(jsonString(f.getName())+":"+raw(f.get(v),p,depth+1,seen,limits,budget));}catch(Throwable ignored){limited(limits,p,"字段读取失败",null,0);}}return "{"+String.join(",",values)+"}";}
      limited(limits,path,"未适配对象: "+name,null,0);return "null";
    }catch(Throwable ignored){limited(limits,path,"快照失败",null,0);return "null";}finally{seen.remove(v);}
  }
  static String safe(Object v,String key,int depth){
    if(key.toLowerCase().matches(".*(password|passwd|secret|token|cookie|authorization|credential|apikey|api_key).*"))return "\"[隐藏]\"";
    if(v==null)return "null";if(depth>4)return "\"[深度限制]\"";
    if(v instanceof Boolean||v instanceof Byte||v instanceof Short||v instanceof Integer||v instanceof Long||v instanceof Float||v instanceof Double)return "synthetic".equals(PLAN.getProperty("policy"))&&RAW.contains(key)?String.valueOf(v):"{\"type\":"+quote(v instanceof Boolean?"boolean":"number")+"}";
    if(v instanceof String s)return "synthetic".equals(PLAN.getProperty("policy"))&&RAW.contains(key)?quote(s):"{\"type\":\"string\",\"length\":"+s.length()+"}";
    Class<?> type=v.getClass();String name=type.getName();
    if(type.isArray()){int size=Array.getLength(v);StringBuilder out=new StringBuilder("{\"type\":\"array\",\"count\":"+size+",\"items\":[");for(int i=0;i<Math.min(size,5);i++){if(i>0)out.append(',');out.append(safe(Array.get(v,i),key,depth+1));}return out.append("]}").toString();}
    if(v instanceof List<?> list&&name.startsWith("java.util.")){StringBuilder out=new StringBuilder("{\"type\":\"array\",\"count\":"+list.size()+",\"items\":[");for(int i=0;i<Math.min(list.size(),5);i++){if(i>0)out.append(',');out.append(safe(list.get(i),key,depth+1));}return out.append("]}").toString();}
    if(v instanceof Map<?,?> map&&name.startsWith("java.util.")){StringBuilder out=new StringBuilder("{");int n=0;for(var entry:map.entrySet()){if(n>=20)break;if(!(entry.getKey() instanceof String k))continue;if(n++>0)out.append(',');out.append(quote(k)).append(':').append(safe(entry.getValue(),k,depth+1));}return out.append('}').toString();}
    if(Arrays.asList(PLAN.getProperty("dtos","").split(",")).contains(name)){
      StringBuilder out=new StringBuilder("{");int n=0;for(Field field:type.getDeclaredFields()){if(n>=20)break;if(Modifier.isStatic(field.getModifiers())||field.isSynthetic())continue;if(!field.trySetAccessible())continue;if(n++>0)out.append(',');out.append(quote(field.getName())).append(':');try{out.append(safe(field.get(v),field.getName(),depth+1));}catch(Throwable ignored){out.append("null");}}return out.append('}').toString();
    }
    return "{\"type\":"+quote(name)+"}";
  }
}
