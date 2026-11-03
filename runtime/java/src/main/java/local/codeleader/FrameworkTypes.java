package local.codeleader;
import io.opentelemetry.javaagent.extension.ignore.IgnoredTypesConfigurer;
import io.opentelemetry.javaagent.extension.ignore.IgnoredTypesBuilder;
/** Allow only the four fixed HTTP adapter classes; all other agent exclusions stay in force. */
public final class FrameworkTypes implements IgnoredTypesConfigurer {
  public void configure(IgnoredTypesBuilder builder){builder.allowClass("org.springframework.http.client.SimpleClientHttpRequest").allowClass("org.springframework.http.client.SimpleClientHttpResponse").allowClass("org.springframework.http.client.JdkClientHttpRequest").allowClass("org.springframework.http.client.JdkClientHttpResponse");}
}
