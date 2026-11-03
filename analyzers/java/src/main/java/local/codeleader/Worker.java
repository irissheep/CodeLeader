package local.codeleader;

import com.github.javaparser.*;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.resolution.declarations.*;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.*;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class Worker {
    static final Gson gson = new Gson();
    static Map<String,Object> range(Node n) {
        var r=n.getRange().orElseThrow();
        return Map.of("start",Map.of("line",r.begin.line-1,"character",r.begin.column-1),"end",Map.of("line",r.end.line-1,"character",r.end.column));
    }
    static String owner(Node n) {
        var cursor=n.getParentNode();
        while(cursor.isPresent()) {
            Node p=cursor.get();
            if(p instanceof MethodDeclaration m) { try{return m.resolve().getQualifiedSignature();}catch(Exception e){return "@"+m.getName().getBegin().orElseThrow().line+":"+m.getName().getBegin().orElseThrow().column;} }
            if(p instanceof ConstructorDeclaration c) {try{return c.resolve().getQualifiedSignature();}catch(Exception e){return "@"+c.getName().getBegin().orElseThrow().line+":"+c.getName().getBegin().orElseThrow().column;} }
            cursor=p.getParentNode();
        }
        return "";
    }
    static void inheritance(List<Object> output, String file, ClassOrInterfaceDeclaration declaration, ClassOrInterfaceType reference, String kind) {
        String target=reference.toString(), status="unresolved", reason="";
        try {target=reference.resolve().asReferenceType().getQualifiedName();status="resolved";} catch(Exception error){reason=error.toString();}
        output.add(Map.of("file",file,"range",range(declaration.getName()),"target",target,"type",kind,"location",range(reference),"status",status,"reason",reason));
    }
    static Map<String,Object> analyze(JsonObject req) throws Exception {
        Path root=Path.of(req.get("root").getAsString());
        CombinedTypeSolver solver=new CombinedTypeSolver(new ReflectionTypeSolver(true));
        List<String> diagnostics=new ArrayList<>();
        var config=new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.BLEEDING_EDGE).setTabSize(1).setSymbolResolver(new JavaSymbolSolver(solver));
        for(JsonElement e:req.getAsJsonArray("sourceRoots")) {try{solver.add(new JavaParserTypeSolver(Path.of(e.getAsString()),config));}catch(Exception x){diagnostics.add(x.toString());}}
        for(JsonElement e:req.getAsJsonArray("jars")) {try{solver.add(new JarTypeSolver(e.getAsString()));}catch(Exception x){diagnostics.add(x.toString());}}
        JavaParser parser=new JavaParser(config);
        List<Object> symbols=new ArrayList<>(), calls=new ArrayList<>(), inheritance=new ArrayList<>();
        for(JsonElement e:req.getAsJsonArray("files")) {
            String file=e.getAsString();
            var parsed=parser.parse(root.resolve(file));
            if(!parsed.isSuccessful()) diagnostics.add(file+": "+parsed.getProblems());
            if(parsed.getResult().isEmpty()) continue;
            CompilationUnit cu=parsed.getResult().get();
            for(var m:cu.findAll(CallableDeclaration.class)) {
                String qualified="";
                try { if(m instanceof MethodDeclaration d) qualified=d.resolve().getQualifiedSignature(); else if(m instanceof ConstructorDeclaration d) qualified=d.resolve().getQualifiedSignature(); }catch(Exception x){diagnostics.add(file+": 签名未解析 "+m.getNameAsString());}
                symbols.add(Map.of("file",file,"range",range(m.getName()),"qualified",qualified));
            }
            for(var type:cu.findAll(ClassOrInterfaceDeclaration.class)) {
                for(var ext:type.getExtendedTypes()) inheritance(inheritance,file,type,ext,"EXTENDS");
                for(var impl:type.getImplementedTypes()) inheritance(inheritance,file,type,impl,"IMPLEMENTS");
            }
            for(var n:cu.findAll(Node.class)) {
                if(!(n instanceof MethodCallExpr)&&!(n instanceof ObjectCreationExpr)) continue;
                String from=owner(n); if(from.isEmpty()) continue;
                String target="", reason=""; boolean candidate=false;
                try {
                    if(n instanceof MethodCallExpr call) {
                        var resolved=call.resolve(); target=resolved.getQualifiedSignature();
                        candidate=resolved.declaringType().isInterface();
                    } else target=((ObjectCreationExpr)n).resolve().getQualifiedSignature();
                } catch(Exception x){reason=x.getClass().getSimpleName()+": "+String.valueOf(x.getMessage());}
                calls.add(Map.of("file",file,"from",from,"target",target,"text",n.toString(),"range",range(n),"status",target.isEmpty()?"unresolved":candidate?"candidate":"resolved","reason",reason));
            }
        }
        return Map.of("symbols",symbols,"calls",calls,"inheritance",inheritance,"diagnostics",diagnostics);
    }
    public static void main(String[] args) throws Exception {
        var reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
        var out=new PrintWriter(new OutputStreamWriter(System.out,StandardCharsets.UTF_8),true);
        for(String line;(line=reader.readLine())!=null;) {
            try {var req=JsonParser.parseString(line).getAsJsonObject();out.println(gson.toJson(Map.of("id",req.get("id"),"result",analyze(req))));}
            catch(Throwable e){System.err.println(e);out.println(gson.toJson(Map.of("error",e.toString())));}
        }
    }
}
