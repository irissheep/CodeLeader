"""Installed by the explicit launcher before importing the business application.
No eager imports of application modules, getters, serializers, generators or coroutines.
"""
import contextvars, functools, importlib.abc, importlib.machinery, inspect, json, os, sys, time, threading, uuid, itertools
from collections import OrderedDict
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.trace import Status, StatusCode
import dis

PLAN = json.load(open(os.environ['CODELEADER_PLAN'], encoding='utf-8'))
POLICY = os.environ.get('CODELEADER_POLICY', 'structure')
RAW = {'question', 'answer', 'mode', 'id', 'userId', 'user_id', 'noteId', 'note_id', 'revision', 'count', 'indexed', 'reason'}
DEPTH = contextvars.ContextVar('codeleader_depth', default=0)
POINT = contextvars.ContextVar('codeleader_point', default='')
COUNTS = OrderedDict()
SAFE_CLASSES = set()
PROCESS = str(os.getpid())+':'+uuid.uuid4().hex
INVOCATION = contextvars.ContextVar('codeleader_invocation', default='')
ROOTS = tuple(os.path.normcase(os.path.realpath(p)) for p in json.loads(os.environ.get('CODELEADER_PYTHON_ROOTS','["'+os.getcwd().replace('\\','\\\\')+'"]')))
EXCLUDED_URLS = os.environ.get('CODELEADER_EXCLUDED_URLS', PLAN.get('excludedUrls',''))
def owned(file):
    file=os.path.normcase(os.path.realpath(file))
    return any(file.startswith(root+os.sep) for root in ROOTS)

def actual(v):
    limits, seen, budget = [], set(), [0]
    def limit(path,reason,length=None,saved=None):
        if len(limits)<64: limits.append(dict(path=path[:512],reason=reason,**({'originalLength':length} if length is not None else {}),**({'saved':saved} if saved is not None else {})))
    def walk(value,path='',depth=0):
        if budget[0]>50000: limit(path,'字节预算'); return None
        budget[0]+=16
        if value is None or type(value) in (bool,int,float): return value
        if type(value) is str:
            count=min(len(value),8192);budget[0]+=count*3
            if count<len(value):limit(path,'字符串预算',len(value),count)
            return value[:count]
        if depth>=6: limit(path,'深度预算'); return None
        if id(value) in seen: limit(path,'循环引用'); return None
        seen.add(id(value))
        try:
            if type(value) in (list,tuple):
                if len(value)>50:limit(path,'数组预算',len(value),50)
                return [walk(item,path+'['+str(i)+']',depth+1) for i,item in enumerate(value[:50])]
            if type(value) is dict:
                if len(value)>64:limit(path,'字段预算',len(value),64)
                result={}
                for key,item in itertools.islice(value.items(),64):
                    if type(key) is not str: limit(path,'非字符串键');continue
                    if len(key)>256: limit(path,'字段名预算',len(key),0);continue
                    budget[0]+=len(key)*6
                    result[key]=walk(item,path+'.'+key if path else key,depth+1)
                return result
            if type(value) in SAFE_CLASSES:return walk(object.__getattribute__(value,'__dict__'),path,depth+1)
            limit(path,'未适配对象: '+type(value).__name__);return None
        finally:seen.discard(id(value))
    value=walk(v)
    result={'__codeleader_snapshot':2,'value':value,'limits':limits}
    size=len(json.dumps(result,ensure_ascii=False,allow_nan=False).encode())
    return result if size<=65536 else {'__codeleader_snapshot':2,'value':None,'limits':[{'path':'','reason':'快照字节预算','originalLength':size,'saved':0,'unit':'字节'}]}

def exception_details(error, depth=0, seen=None):
    seen=set() if seen is None else seen
    result={'type':type(error).__name__}
    if id(error) in seen:return {**result,'causeNotice':'原因重复，已停止展开'}
    seen.add(id(error))
    args=BaseException.args.__get__(error,type(error))
    if len(args)==1 and type(args[0]) is str:result['message']=args[0]
    elif not args:result['message']=None
    else:result['messageNotice']='没有保存异常消息'
    frames=[];tb=BaseException.__traceback__.__get__(error,type(error))
    while tb is not None and len(frames)<24:
        code=tb.tb_frame.f_code;frames.append(dict(file=code.co_filename,method=code.co_name,line=tb.tb_lineno));tb=tb.tb_next
    result['stack']=list(reversed(frames))
    if tb is not None:result['stackNotice']='还有更早的位置，未继续保存'
    cause=BaseException.__cause__.__get__(error,type(error))
    if cause is None and not BaseException.__suppress_context__.__get__(error,type(error)):cause=BaseException.__context__.__get__(error,type(error))
    if cause is None:result['cause']=None
    elif depth<2:result['cause']=exception_details(cause,depth+1,seen)
    else:result['causeNotice']='还有后续原因，未继续保存'
    return result

def safe(v, key='', depth=0):
    if POLICY=='raw':return actual(v)
    if any(word in key.lower() for word in ('password','passwd','secret','token','cookie','authorization','credential','api_key')):
        return '[隐藏]'
    if v is None: return v
    if type(v) in (bool,int,float): return v if POLICY=='synthetic' and key in RAW else {'type':type(v).__name__}
    if depth > 4: return '[深度限制]'
    if type(v) is str:
        return v[:640] if POLICY == 'synthetic' and key in RAW else {'type': 'string', 'length': len(v)}
    if type(v) in (list, tuple):
        return {'type':'array', 'count':len(v), 'items':[safe(x,key,depth+1) for x in v[:5]]}
    if type(v) is dict:
        return {k:safe(x,k,depth+1) for k,x in list(v.items())[:20] if type(k) is str}
    if type(v) in SAFE_CLASSES:
        fields=object.__getattribute__(v, '__dict__')
        return {k:safe(x,k,depth+1) for k,x in list(fields.items())[:20] if not k.startswith('_')}
    return {'type':type(v).__name__}

def encoded(v):
    s=json.dumps(v,ensure_ascii=False,allow_nan=False)
    return s if len(s.encode()) <= (72000 if POLICY=='raw' else 12000) else '{"truncated":true,"reason":"snapshot budget"}'

class PrivateExporter(SpanExporter):
    def __init__(self):
        self.delegate=OTLPSpanExporter(endpoint=os.environ['CODELEADER_OTLP']+'/v1/traces', timeout=1)
    def export(self, spans):
        allowed=('codeleader.', 'http.request.method','http.response.status_code','http.method','http.status_code','http.route','server.address','server.port')
        clean=[]
        for s in spans:
            attrs={k:v for k,v in s.attributes.items() if any(k.startswith(p) for p in allowed) or POLICY=='raw' and k.startswith('db.')}
            clean.append(ReadableSpan(name=s.name, context=s.context, parent=s.parent, resource=s.resource,
                attributes=attrs, events=(), links=s.links, kind=s.kind, start_time=s.start_time, end_time=s.end_time,
                status=Status(s.status.status_code), instrumentation_scope=s.instrumentation_scope))
        return self.delegate.export(clean)
    def shutdown(self): self.delegate.shutdown()
    def force_flush(self, timeout_millis=1000): return self.delegate.force_flush(timeout_millis)

provider=TracerProvider(resource=Resource.create({'service.name':os.environ.get('CODELEADER_SERVICE','python'),
    'codeleader.session':os.environ['CODELEADER_SESSION'], 'codeleader.service_id':os.environ.get('CODELEADER_SERVICE_ID',''), 'codeleader.version':PLAN['sourceVersion']}))
provider.add_span_processor(BatchSpanProcessor(PrivateExporter(), max_queue_size=512,max_export_batch_size=64,schedule_delay_millis=250,export_timeout_millis=1000))
trace.set_tracer_provider(provider)
tracer=trace.get_tracer('codeleader.values','1')
# Standard instrumentation patches FastAPI construction before its routes are registered.
for framework in ('fastapi','flask','sqlalchemy'):
    try:
        if framework=='fastapi':
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            FastAPIInstrumentor().instrument(tracer_provider=provider, excluded_urls=EXCLUDED_URLS, exclude_spans=['receive','send'])
        elif framework=='flask':
            from opentelemetry.instrumentation.flask import FlaskInstrumentor
            FlaskInstrumentor().instrument(tracer_provider=provider, excluded_urls=EXCLUDED_URLS)
        else:
            from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
            SQLAlchemyInstrumentor().instrument(tracer_provider=provider)
    except (ImportError, ModuleNotFoundError):
        pass
    except BaseException:
        print('CodeLeader observation unavailable for '+framework,file=sys.stderr)

def wrap(fn, point=None, chroma=False):
    if getattr(fn,'__codeleader__',False) or inspect.iscoroutinefunction(fn) or inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn): return fn
    @functools.wraps(fn)
    def call(*args, **kwargs):
        parent=trace.get_current_span().get_span_context()
        if not parent.is_valid or (chroma and not DEPTH.get()): return fn(*args,**kwargs)
        tid=parent.trace_id
        count=COUNTS.get(tid,0)+1;COUNTS[tid]=count
        if len(COUNTS)>1024: COUNTS.popitem(last=False)
        if count>300:
            trace.get_current_span().set_attribute('codeleader.dropped',count-300)
            return fn(*args,**kwargs)
        span=None;context=None;token=None;point_token=None;invocation_token=None;started=time.perf_counter_ns();parent_invocation=INVOCATION.get()
        try:
            span=tracer.start_span('Chroma collection.query' if chroma else point['owner']+'.'+point['method'])
            span.set_attribute('codeleader.version',PLAN['sourceVersion'])
            span.set_attribute('codeleader.invocation',format(span.get_span_context().span_id,'016x'))
            span.set_attribute('codeleader.process',PROCESS);span.set_attribute('codeleader.clock',PROCESS);span.set_attribute('codeleader.thread',threading.get_ident())
            if parent_invocation:span.set_attribute('codeleader.sync_parent',parent_invocation)
            if point: span.set_attribute('codeleader.point',point['id'])
            if chroma:
                span.set_attribute('codeleader.from',POINT.get())
                inputs={'operation':'query','where':kwargs.get('where',{}),'requested':kwargs.get('n_results'),'query_texts':kwargs.get('query_texts'),'query_embeddings':kwargs.get('query_embeddings')}
                inputs=actual(inputs) if POLICY=='raw' else {'operation':'query','where':safe(kwargs.get('where',{})),'requested':kwargs.get('n_results')}
                span.set_attribute('codeleader.boundary','chroma.query')
            else:
                names=point['parameterNames']
                inputs={name:v if POLICY=='raw' else safe(v,name) for name,v in zip(names,args[1:])}
                inputs.update({name:v if POLICY=='raw' else safe(v,name) for name,v in kwargs.items()})
                if POLICY=='raw':inputs=actual(inputs)
            span.set_attribute('codeleader.input',encoded(inputs))
            context=trace.use_span(span,end_on_exit=False,record_exception=False,set_status_on_exception=False)
            context.__enter__();token=DEPTH.set(DEPTH.get()+1)
            invocation_token=INVOCATION.set(format(span.get_span_context().span_id,'016x'))
            if POLICY=='raw':
                event=tracer.start_span(span.name)
                for key,value in dict(span.attributes).items():event.set_attribute(key,value)
                event.set_attribute('codeleader.phase','enter');event.set_attribute('codeleader.parent',format(parent.span_id,'016x'));event.end()
            if point: point_token=POINT.set(point['id'])
        except BaseException:
            if token is not None: DEPTH.reset(token)
            if invocation_token is not None: INVOCATION.reset(invocation_token)
            if context is not None: context.__exit__(None,None,None)
            if span is not None: span.set_attribute('codeleader.capture.error',True);span.end()
            return fn(*args,**kwargs)
        try:
            result=fn(*args,**kwargs)
        except BaseException as error:
            try:
                span.set_status(Status(StatusCode.ERROR))
                span.set_attribute('codeleader.error',encoded(actual(exception_details(error)) if POLICY=='raw' else {'type':type(error).__name__}))
            except BaseException: pass
            raise
        else:
            try:
                output=actual({**result,'count':len(result.get('ids',[[]])[0])}) if chroma and POLICY=='raw' else {'count':len(result.get('ids',[[]])[0])} if chroma else safe(result,'result')
                span.set_attribute('codeleader.output',encoded(output))
            except BaseException: pass
            return result
        finally:
            try:
                if point_token is not None: POINT.reset(point_token)
                if invocation_token is not None: INVOCATION.reset(invocation_token)
                DEPTH.reset(token);context.__exit__(None,None,None)
                span.set_attribute('codeleader.phase','exit')
                span.set_attribute('codeleader.duration_ms',(time.perf_counter_ns()-started)/1000000);span.end()
            except BaseException: pass
    call.__codeleader__=True
    return call

FUNCTION_POINTS={}
FRAMES=threading.local()
def profile(frame,event,arg):
    # Profile only known top-level functions. Decorators keep their normal registration
    # and control flow; an authentication wrapper is never claimed as the route body.
    try:
        frames=getattr(FRAMES,'calls',None)
        if event=='call':
            point=FUNCTION_POINTS.get(frame.f_code)
            parent=trace.get_current_span().get_span_context()
            if point is None or not parent.is_valid: return
            count=COUNTS.get(parent.trace_id,0)+1;COUNTS[parent.trace_id]=count
            if count>PLAN['budgets']['invocations']: return
            if frames is None: frames={};FRAMES.calls=frames
            span=tracer.start_span(point['module']+'.'+point['method'])
            attrs={'codeleader.version':PLAN['sourceVersion'],'codeleader.point':point['id'],
                'codeleader.invocation':format(span.get_span_context().span_id,'016x'),
                'codeleader.process':PROCESS,'codeleader.clock':PROCESS,'codeleader.thread':threading.get_ident()}
            if INVOCATION.get(): attrs['codeleader.sync_parent']=INVOCATION.get()
            inputs={name:frame.f_locals[name] for name in point['parameterNames'] if name in frame.f_locals}
            attrs['codeleader.input']=encoded(actual(inputs) if POLICY=='raw' else safe(inputs))
            for key,value in attrs.items():span.set_attribute(key,value)
            if POLICY=='raw':
                entering=tracer.start_span(span.name)
                for key,value in attrs.items():entering.set_attribute(key,value)
                entering.set_attribute('codeleader.phase','enter');entering.set_attribute('codeleader.parent',format(parent.span_id,'016x'));entering.end()
            context=trace.use_span(span,end_on_exit=False,record_exception=False,set_status_on_exception=False);context.__enter__()
            frames[frame]=(span,context,DEPTH.set(DEPTH.get()+1),INVOCATION.set(attrs['codeleader.invocation']),POINT.set(point['id']),time.perf_counter_ns())
        elif event=='return' and frames and frame in frames:
            span,context,depth,invocation,point,started=frames.pop(frame)
            try:
                if frame.f_lasti>=0 and dis.opname[frame.f_code.co_code[frame.f_lasti]].startswith('RETURN'):
                    span.set_attribute('codeleader.output',encoded(safe(arg,'result')))
                else:span.set_attribute('codeleader.capture.error',True)
                span.set_attribute('codeleader.phase','exit');span.set_attribute('codeleader.duration_ms',(time.perf_counter_ns()-started)/1000000)
            finally:
                POINT.reset(point);INVOCATION.reset(invocation);DEPTH.reset(depth);context.__exit__(None,None,None);span.end()
    except BaseException:
        # A recorder callback must never raise into the application.
        pass

def patch(module):
    for value in vars(module).values():
        if isinstance(value,type) and value.__module__==module.__name__ and (owned(getattr(module,'__file__','')) or hasattr(value,'model_fields')):
            SAFE_CLASSES.add(value)
    for p in PLAN['points']:
        if p['language']!='python' or p.get('module')!=module.__name__ or os.environ.get('CODELEADER_SERVICE_ID') and p.get('serviceId')!=os.environ['CODELEADER_SERVICE_ID']: continue
        file=os.path.normcase(os.path.realpath(getattr(module,'__file__','')))
        if not file.endswith(os.sep+os.path.normcase(p['file'].replace('/',os.sep))): continue
        if p.get('binding')=='function':
            fn=vars(module).get(p['method'])
            while inspect.isfunction(fn):
                if fn.__code__.co_name==p['method'] and owned(fn.__code__.co_filename):FUNCTION_POINTS[fn.__code__]=p;break
                fn=vars(fn).get('__wrapped__')
            continue
        cls=vars(module).get(p['owner'])
        if not isinstance(cls,type): continue
        fn=vars(cls).get(p['method'])
        if inspect.isfunction(fn): setattr(cls,p['method'],wrap(fn,p))
    if module.__name__=='chromadb.api.models.Collection':
        cls=vars(module).get('Collection')
        if cls and inspect.isfunction(vars(cls).get('query')): cls.query=wrap(cls.query,chroma=True)

class Loader(importlib.abc.Loader):
    def __init__(self, original): self.original=original
    def create_module(self,spec):
        return self.original.create_module(spec) if hasattr(self.original,'create_module') else None
    def exec_module(self,module):
        self.original.exec_module(module)
        try: patch(module)
        except BaseException: pass

class Finder(importlib.abc.MetaPathFinder):
    modules={p.get('module') for p in PLAN['points'] if p['language']=='python'}|set(PLAN.get('pythonModules',[]))|{'chromadb.api.models.Collection'}
    def find_spec(self,fullname,path=None,target=None):
        # Schema modules are imported naturally; never eagerly import business main.
        if fullname not in self.modules: return None
        spec=importlib.machinery.PathFinder.find_spec(fullname,path,target)
        if spec and spec.loader and hasattr(spec.loader,'exec_module') and (fullname=='chromadb.api.models.Collection' or owned(spec.origin or '')): spec.loader=Loader(spec.loader)
        return spec
sys.meta_path.insert(0,Finder())
sys.setprofile(profile);threading.setprofile(profile)
