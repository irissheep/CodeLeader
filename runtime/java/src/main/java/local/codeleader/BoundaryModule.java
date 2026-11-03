package local.codeleader;
import io.opentelemetry.javaagent.extension.instrumentation.*;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.matcher.ElementMatcher;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.implementation.bytecode.assign.Assigner;
import java.util.*;
import java.io.InputStream;
import static net.bytebuddy.matcher.ElementMatchers.*;

public final class BoundaryModule extends InstrumentationModule {
  public BoundaryModule(){super("codeleader-boundaries");}
  public List<String> getAdditionalHelperClassNames(){return List.of(ValueHelper.class.getName(),ValueHelper.Call.class.getName(),BoundaryHelper.class.getName(),BoundaryHelper.HttpCall.class.getName(),BoundaryHelper.BodyWriter.class.getName(),BoundaryHelper.CaptureOutputStream.class.getName(),BoundaryHelper.CaptureInputStream.class.getName(),BoundaryHelper.SqlState.class.getName(),BoundaryHelper.JdbcCall.class.getName());}
  public List<TypeInstrumentation> typeInstrumentations(){if(!"raw".equals(System.getenv("CODELEADER_POLICY")))return List.of();return List.of(
    instrument(named("org.springframework.http.client.JdkClientHttpRequest").or(named("org.springframework.http.client.SimpleClientHttpRequest")),named("executeInternal").and(takesArguments(2)),HttpAdvice.class),
    instrument(named("org.springframework.http.client.JdkClientHttpResponse").or(named("org.springframework.http.client.SimpleClientHttpResponse")),named("getBody").and(takesArguments(0)),ResponseBodyAdvice.class),
    instrument(named("org.springframework.http.client.JdkClientHttpResponse").or(named("org.springframework.http.client.SimpleClientHttpResponse")),named("close").and(takesArguments(0)),HttpCloseAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.").and(hasSuperType(named("java.sql.Connection"))),named("prepareStatement").and(takesArgument(0,String.class)),PrepareAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.").and(hasSuperType(named("java.sql.PreparedStatement"))),nameStartsWith("set").or(named("clearParameters")).or(named("addBatch")).or(named("clearBatch")),BindAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.").and(hasSuperType(named("java.sql.PreparedStatement"))),nameStartsWith("execute").and(takesArguments(0)),ExecuteAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.").and(hasSuperType(named("java.sql.Statement"))),named("getResultSet").and(takesArguments(0)),ResultAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.result.").and(hasSuperType(named("java.sql.ResultSet"))),named("next").or(nameStartsWith("get").and(takesArguments(1))),RowAdvice.class),
    instrument(nameStartsWith("com.mysql.cj.jdbc.").and(hasSuperType(named("java.sql.Statement")).or(hasSuperType(named("java.sql.ResultSet")))),named("close").and(takesArguments(0)),JdbcCloseAdvice.class));}
  static TypeInstrumentation instrument(ElementMatcher<TypeDescription> type,ElementMatcher<? super MethodDescription> method,Class<?> advice){return new TypeInstrumentation(){public ElementMatcher<TypeDescription> typeMatcher(){return type;}public void transform(TypeTransformer transformer){transformer.applyAdviceToMethod(method,advice.getName());}};}
  public static class HttpAdvice {@Advice.OnMethodEnter(suppress=Throwable.class) public static BoundaryHelper.HttpCall enter(@Advice.This Object request,@Advice.Argument(0) Object headers,@Advice.Argument(value=1,readOnly=false,typing=Assigner.Typing.DYNAMIC) Object body){BoundaryHelper.HttpCall call=BoundaryHelper.httpEnter(request,headers);body=BoundaryHelper.body(body,call);return call;}@Advice.OnMethodExit(onThrowable=Throwable.class,suppress=Throwable.class) public static void exit(@Advice.Enter BoundaryHelper.HttpCall call,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object response,@Advice.Thrown Throwable error){BoundaryHelper.httpExit(call,response,error);}}
  public static class ResponseBodyAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.This Object response,@Advice.Return(readOnly=false) InputStream stream){stream=BoundaryHelper.responseBody(response,stream);}}
  public static class HttpCloseAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.This Object response){BoundaryHelper.httpClose(response);}}
  public static class PrepareAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.Argument(0) Object sql,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object statement){BoundaryHelper.prepared(statement,sql);}}
  public static class BindAdvice {@Advice.OnMethodEnter(suppress=Throwable.class) public static void enter(@Advice.This Object statement,@Advice.Origin("#m") String method,@Advice.AllArguments Object[] args){BoundaryHelper.binding(statement,method,args);}}
  public static class ExecuteAdvice {@Advice.OnMethodEnter(suppress=Throwable.class) public static BoundaryHelper.JdbcCall enter(@Advice.This Object statement){return BoundaryHelper.jdbcEnter(statement);}@Advice.OnMethodExit(onThrowable=Throwable.class,suppress=Throwable.class) public static void exit(@Advice.This Object statement,@Advice.Enter BoundaryHelper.JdbcCall call,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object result,@Advice.Thrown Throwable error){BoundaryHelper.jdbcExit(statement,call,result,error);}}
  public static class ResultAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.This Object statement,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object result){BoundaryHelper.result(statement,result);}}
  public static class RowAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.This Object result,@Advice.Origin("#m") String method,@Advice.AllArguments Object[] args,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object value){BoundaryHelper.row(result,method,args,value);}}
  public static class JdbcCloseAdvice {@Advice.OnMethodExit(suppress=Throwable.class) public static void exit(@Advice.This Object value){BoundaryHelper.jdbcClose(value);}}
}
