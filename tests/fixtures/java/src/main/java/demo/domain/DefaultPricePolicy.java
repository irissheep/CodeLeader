package demo.domain;
public class DefaultPricePolicy implements PricePolicy {
    public int price(int base) { return base + 2; }
}
