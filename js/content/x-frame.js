/* Classic script deliberately confined to an opaque-origin sandbox.
 * Never import this file into the main application or add allow-same-origin.
 */
(() => {
  'use strict';
  const parameters=new URLSearchParams(location.search),id=parameters.get('id'),token=parameters.get('token');
  if (parent===window || !/^[1-9]\d{0,19}$/.test(id??'') || !/^mikeryan-x-\d+$/.test(token??'')) return;
  let done=false,observer;
  const report=(status,height)=>parent.postMessage({source:'mikeryan-x-embed',token,status,height},'*');
  const fail=()=>{if (done) return;done=true;clearTimeout(deadline);observer?.disconnect();report('error');};
  const deadline=setTimeout(fail,12000);
  window.addEventListener('error',fail,{once:true});
  window.addEventListener('unhandledrejection',fail,{once:true});
  const script=document.createElement('script');script.src='https://platform.twitter.com/widgets.js';script.async=true;script.onerror=fail;
  script.onload=async()=>{
    try {
      if (done || !window.twttr?.widgets?.createTweet) { fail();return; }
      const root=document.getElementById('tweet');
      const result=await window.twttr.widgets.createTweet(id,root,{theme:parameters.get('theme')==='dark'?'dark':'light',dnt:true,conversation:'none',width:Math.max(250,Math.min(550,document.documentElement.clientWidth))});
      if (done) return;
      if (!result || !root.querySelector('iframe')) { fail();return; }
      clearTimeout(deadline);
      let lastHeight=0;
      const resize=()=>{const height=Math.ceil(root.getBoundingClientRect().height);if (height>0&&height!==lastHeight) {lastHeight=height;report('ready',height);}};
      observer=new ResizeObserver(resize);observer.observe(root);resize();
    } catch { fail(); }
  };
  document.head.append(script);
})();
