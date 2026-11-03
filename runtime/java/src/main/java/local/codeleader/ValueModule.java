package local.codeleader;

import io.opentelemetry.javaagent.extension.instrumentation.*;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.matcher.ElementMatcher;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.implementation.bytecode.assign.Assigner;
import java.util.*;
import java.io.*;
import java.lang.reflect.Method;
import static net.bytebuddy.matcher.ElementMatchers.*;

/** Exact, finite signatures generated before application class loading. */
public final class ValueModule extends InstrumentationModule {
  public ValueModule(){super("codeleader-values");}
  public List<TypeInstrumentation> typeInstrumentations(){
    Properties plan=new Properties();
    try(var in=new FileInputStream(System.getenv("CODELEADER_PLAN"))){plan.load(in);}catch(Exception ignored){return List.of();}
    List<TypeInstrumentation> result=new ArrayList<>();
    for(String owner:plan.getProperty("owners","").split(","))if(!owner.isBlank())result.add(new TypeInstrumentation(){
      public ElementMatcher<TypeDescription> typeMatcher(){return named(owner);}
      public void transform(TypeTransformer transformer){
        for(String key:plan.stringPropertyNames())if(key.startsWith("method."+owner+"#")){
          String signature=key.substring(7+owner.length()+1);int bracket=signature.indexOf('(');
          String method=signature.substring(0,bracket),params=signature.substring(bracket+1,signature.length()-1);
          String[] types=params.isEmpty()?new String[0]:params.split(",");
          ElementMatcher.Junction<MethodDescription> matcher=named(method).and(takesArguments(types.length)).and(not(isAbstract())).and(not(isSynthetic()));
          for(int i=0;i<types.length;i++)matcher=matcher.and(takesArgument(i,named(types[i])));
          transformer.applyAdviceToMethod(matcher,ValueAdvice.class.getName());
        }
      }
    });
    return result;
  }
  public List<String> getAdditionalHelperClassNames(){return List.of(ValueHelper.class.getName(),ValueHelper.Call.class.getName());}
  public static class ValueAdvice {
    @Advice.OnMethodEnter(suppress=Throwable.class)
    public static ValueHelper.Call enter(@Advice.Origin Method method,@Advice.AllArguments Object[] args){return ValueHelper.enter(method,args);}
    @Advice.OnMethodExit(onThrowable=Throwable.class,suppress=Throwable.class)
    public static void exit(@Advice.Enter ValueHelper.Call call,@Advice.Return(typing=Assigner.Typing.DYNAMIC) Object result,@Advice.Thrown Throwable error){ValueHelper.exit(call,result,error);}
  }
}
