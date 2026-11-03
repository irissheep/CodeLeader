import sys, runpy
try:
    import observe
except BaseException as error:
    print('CodeLeader observation unavailable; application continues: '+type(error).__name__,file=sys.stderr)
if sys.argv[1]=='--module':
    module=sys.argv[2];sys.argv=sys.argv[2:];runpy.run_module(module,run_name='__main__',alter_sys=True)
elif sys.argv[1]=='--file':
    file=sys.argv[2];sys.argv=sys.argv[2:];runpy.run_path(file,run_name='__main__')
else:
    # Explicit older saved uvicorn launch arguments remain readable.
    import uvicorn
    uvicorn.run(sys.argv[1],host='127.0.0.1',port=int(sys.argv[2]),access_log=False,log_level='warning')
