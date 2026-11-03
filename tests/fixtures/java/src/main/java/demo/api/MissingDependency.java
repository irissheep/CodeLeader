package demo.api;
import absent.Library;
class MissingDependency { void unresolved() { Library.notAvailable(); } }
class MissingBase extends UnknownBase {}
