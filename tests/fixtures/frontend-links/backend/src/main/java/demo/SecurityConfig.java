package demo;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain chain(HttpSecurity security) throws Exception {
        return security
            // Newlines and comments are Java trivia, not a different receiver.
            .logout(config -> config.logoutUrl("/sign-out"))
            .build();
    }
    SecurityFilterChain unused(HttpSecurity security) throws Exception {
        return security.logout(config -> config.logoutUrl("/not-entry")).build();
    }
}
