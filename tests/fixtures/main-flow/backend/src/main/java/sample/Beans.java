package sample;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
interface Port { void send(); }
@Component class One implements Port { public void send() {} }
@Component class Two implements Port { public void send() {} }
@Component class Ambiguous {
    private final Port port;
    Ambiguous(Port port) { this.port=port; }
    void invoke() { port.send(); }
}
@Component class Chosen {
    private final Port port;
    Chosen(@Qualifier("one") Port port) { this.port=port; }
    void invoke() { port.send(); }
}
class Base {}
class Derived extends Base {}
interface Preferred { void send(); }
@Component @Primary class First implements Preferred { public void send() {} }
@Component class Second implements Preferred { public void send() {} }
@Component class PrimaryConsumer {
    private final Preferred port;
    PrimaryConsumer(Preferred port) { this.port=port; }
    void invoke() { port.send(); }
}
interface FactoryPort { int value(); }
class FactoryImpl implements FactoryPort { public int value() { return 1; } }
@Configuration class FactoryConfig {
    @Bean FactoryPort factoryPort() { return new FactoryImpl(); }
}
@Component class FieldConsumer {
    @Autowired @Qualifier("factoryPort") private FactoryPort port;
    int value() { return port.value(); }
}
