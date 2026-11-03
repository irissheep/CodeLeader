import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './graph-theme.css';
import './canvas.css';
import './chrome.css';
import './operation-evidence.css';
import uiTokens,{tokenVariables} from '../shared/ui-tokens';
import './ui-system.css';
import './motion.css';
import './packet-motion.css';
import './replay-motion.css';
import './adaptive-look.css';
import './layout.css';
import './hierarchy.css';
import './dependency-lanes.css';
import './ui-wording.css';
import './view-transition.css';
import './zoom.css';
import {look} from './adaptive-look';
for(const [name,value]of tokenVariables())document.documentElement.style.setProperty(name,value);
for(const [name,value]of Object.entries(uiTokens.hierarchy)){if(typeof value==='number'){document.documentElement.style.setProperty(`--hierarchy-${name}-px`,value+'px');document.documentElement.style.setProperty(`--hierarchy-${name}-ms`,value+'ms');}}
for(const [name,value]of Object.entries(uiTokens.lanes)){if(typeof value==='number'){document.documentElement.style.setProperty(`--lanes-${name}-px`,value+'px');document.documentElement.style.setProperty(`--lanes-${name}-ms`,value+'ms');}}
for(const [name,value]of Object.entries(look)){document.documentElement.style.setProperty(`--look-${name}`,String(value));document.documentElement.style.setProperty(`--look-${name}-px`,value+'px');}
createRoot(document.getElementById('root')!).render(<App/>);
