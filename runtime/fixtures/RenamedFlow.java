package demo;
import java.util.*;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;
public class RenamedFlow {
  public record Reply(String answer) {}
  public static class Dispatch {
    public Reply submit(Map<String,Object> request) {
      String question=(String)request.get("question");
      request.put("question","modified after entry");
      if(question.equals("failure"))throw new IllegalStateException("SECRET_SHOULD_NOT_EXPORT");
      return new Reply(question);
    }
    public String submit(String other){return other;}
  }
  public static void main(String[] args){
    Span root=GlobalOpenTelemetry.getTracer("fixture").spanBuilder("fixture root").startSpan();
    try(Scope scope=root.makeCurrent()){
      Dispatch dispatch=new Dispatch();
      for(String question:List.of("first test","second test","failure")){
        Map<String,Object> input=new HashMap<>();input.put("question",question);input.put("password","SECRET_SHOULD_NOT_EXPORT");
        try{dispatch.submit(input);}catch(IllegalStateException expected){}
        if(!input.get("question").equals("modified after entry"))throw new AssertionError("business mutation changed");
      }
      if(!dispatch.submit("unobserved overload").equals("unobserved overload"))throw new AssertionError();
    }finally{root.end();}
    System.out.println("business calls=3, mutation preserved, exception preserved");
  }
}
