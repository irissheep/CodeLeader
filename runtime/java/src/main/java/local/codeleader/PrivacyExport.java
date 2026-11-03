package local.codeleader;
import io.opentelemetry.sdk.autoconfigure.spi.*;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import io.opentelemetry.sdk.trace.data.*;
import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.api.common.*;
import java.util.*;

/** Remove unapproved SDK attributes/events BEFORE the local exporter sees them. */
public final class PrivacyExport implements AutoConfigurationCustomizerProvider {
  public void customize(AutoConfigurationCustomizer c){c.addSpanExporterCustomizer((delegate,config)->new SpanExporter(){
    public CompletableResultCode export(Collection<SpanData> spans){return delegate.export(spans.stream().map(s->(SpanData)new DelegatingSpanData(s){
      public io.opentelemetry.sdk.resources.Resource getResource(){return io.opentelemetry.sdk.resources.Resource.create(Attributes.of(AttributeKey.stringKey("codeleader.service_id"),System.getenv("CODELEADER_SERVICE_ID")==null?"":System.getenv("CODELEADER_SERVICE_ID"),AttributeKey.stringKey("service.name"),s.getResource().getAttribute(AttributeKey.stringKey("service.name"))==null?"java":s.getResource().getAttribute(AttributeKey.stringKey("service.name")),AttributeKey.stringKey("codeleader.version"),System.getenv("CODELEADER_VERSION")==null?"":System.getenv("CODELEADER_VERSION")));}
      public io.opentelemetry.sdk.trace.data.StatusData getStatus(){return s.getStatus().getStatusCode()==io.opentelemetry.api.trace.StatusCode.ERROR?io.opentelemetry.sdk.trace.data.StatusData.error():io.opentelemetry.sdk.trace.data.StatusData.unset();}
      public Attributes getAttributes(){AttributesBuilder b=Attributes.builder();s.getAttributes().forEach((k,v)->{
        String key=k.getKey();if(key.startsWith("codeleader.")||key.matches("http.request.method|http.response.status_code|http.method|http.status_code|http.route|server.address|server.port|db.system.*|db.namespace|db.operation.*|db.query.text|db.statement|db.name|code.function.*|code.namespace")||"raw".equals(System.getenv("CODELEADER_POLICY"))&&key.matches("db.query.parameter.*|db.response.*|http.*header.*|url.full"))put(b,k,v);
      });return b.build();}
      public List<EventData> getEvents(){return List.of();}
    }).toList());}
    public CompletableResultCode flush(){return delegate.flush();}public CompletableResultCode shutdown(){return delegate.shutdown();}
  });}
  private static <T> void put(AttributesBuilder b,AttributeKey<T> k,Object v){b.put(k,(T)v);}
}
