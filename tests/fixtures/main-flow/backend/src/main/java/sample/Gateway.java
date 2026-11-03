package sample;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.client.RestClient;
@Component
public class Gateway {
    private final RestClient client;
    public Gateway(@Value("${remote.url}") String url) { client = RestClient.builder().baseUrl(url).build(); }
    public void call() { client.post().uri("/work").retrieve().toBodilessEntity(); }
    public void branch(boolean deleted) { String endpoint = deleted ? "/index" : "/delete"; client.post().uri(endpoint).retrieve().toBodilessEntity(); }
    public void noRequest() { client.post().uri("/work").retrieve(); }
}
