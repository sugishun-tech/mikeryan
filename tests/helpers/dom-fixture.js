/** Narrow DOM/event fixture for component logic when no browser is available.
 * No layout, event bubbling, provider document, or network behavior is simulated.
 */
export function installDOM(t, {onSource}={}) {
  const sources=[], observers=[];
  class TestNode extends EventTarget {
    constructor(tagName='',text='') {
      super();this.tagName=tagName.toUpperCase();this.children=[];this.parentNode=null;
      this.dataset={};this.attributes=new Map();this._text=text;this._className='';
      this.classList={
        contains:name=>this._className.split(/\s+/).includes(name),
        add:(...names)=>{this._className=[...new Set([...this._className.split(/\s+/).filter(Boolean),...names])].join(' ');},
        remove:(...names)=>{this._className=this._className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},
        toggle:(name,force)=>{const add=force??!this.classList.contains(name);add?this.classList.add(name):this.classList.remove(name);return add;}
      };
      if(this.tagName==='IFRAME')this.contentWindow={postMessage(){}};
    }
    get className(){return this._className;}
    set className(value){this._className=String(value);}
    get isConnected(){return this===document.body || Boolean(this.parentNode?.isConnected);}
    get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
    set textContent(value){this.replaceChildren();this._text=String(value);}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of [...this.children])node.remove();this._text='';this.append(...nodes);}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=value;}
    getAttribute(name){return name==='class'?this.className:this.attributes.get(name)??null;}
    removeAttribute(name){this.attributes.delete(name);}
    get src(){return this.attributes.get('src')??'';}
    set src(value){this.attributes.set('src',String(value));sources.push({element:this,url:String(value)});onSource?.(this,String(value));}
    click(){this.dispatchEvent(new Event('click'));}
  }
  const document=new EventTarget();document.body=new TestNode('body');
  document.createElement=tag=>new TestNode(tag);
  document.createElementNS=(ns,tag)=>{const node=new TestNode(tag);node.namespaceURI=ns;return node;};
  document.createTextNode=text=>new TestNode('',String(text));
  document.createDocumentFragment=()=>new TestNode();
  const window=new EventTarget();window.getSelection=()=>null;
  class IntersectionObserver {
    constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}
    observe(node){this.targets.add(node);}
    unobserve(node){this.targets.delete(node);}
    disconnect(){this.targets.clear();}
  }
  class MutationObserver {observe(){}disconnect(){}}
  for(const [name,value]of Object.entries({Node:TestNode,document,window,IntersectionObserver,MutationObserver,location:{href:'https://offline.example/mikeryan/'}})) {
    const old=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    t.after(()=>old?Object.defineProperty(globalThis,name,old):delete globalThis[name]);
  }
  return {
    document,window,sources,
    visible:()=>{for(const observer of observers)observer.callback([...observer.targets].map(target=>({target,isIntersecting:true})));},
    flush:()=>new Promise(resolve=>setImmediate(resolve)),
    message:(source,origin,data)=>{const event=new Event('message');Object.assign(event,{source,origin,data});window.dispatchEvent(event);},
    findAll:(node,predicate)=>findAll(node,predicate)
  };
}

function findAll(node,predicate){return [...(predicate(node)?[node]:[]),...node.children.flatMap(child=>findAll(child,predicate))];}
