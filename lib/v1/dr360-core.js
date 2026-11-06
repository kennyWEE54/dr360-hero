/* ================================================================
   DR360 官网共用代码 v1（照首页现有的写法整理出来，效果一样）
   给新页面用；首页不引用这个文件。
   要改全站效果时：复制成 lib/v2/ 再改，新页面改成引用 v2（jsDelivr 会缓存 @main）。

   页面里这样用：
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/kennyWEE54/dr360-hero@main/lib/v1/dr360-core.css">
     <div id="dr360"> ...
       <script src="https://cdn.jsdelivr.net/gh/kennyWEE54/dr360-hero@main/lib/v1/dr360-core.js"></script>
       每一屏的 script 都包成：
       (window.DR360Q=window.DR360Q||[]).push(function(D){ ... });
     </div>
   这样就算共用文件比页面晚载到，每一屏也会照顺序跑。

   里面有：
     D.scene()    固定画面 + 滚动进度 + rAF（只在看得到、进度有变时才跑）+ 结尾淡出
     D.sink()     转场：只做淡出
     D.frames()   影片序列（先载第一张，再按 8/4/2/1 补，同时最多 6 张，先 decode，相邻两张交叉混合）
     D.steps()    一句一句的文字淡入淡出
     D.canvas()   画布（dpr 上限）
     D.ticks()    SVG 带刻度的圆圈
     D.glowDot()  发光的点（白核心 + 金光晕）
     D.photo()    放照片，留空显示占位
     D.lightbox() 点开看大图
     D.links()    data-link 按钮的网址
     D.footer()   页脚（快速链接 + 总部、营业时间、电话）
     header guard 自动执行：Systeme 的 sticky header 永远在最上层
   ================================================================ */
(function(){
  if(window.DR360&&window.DR360.v) return;
  var D={v:1, BP:768};

  /* ---------- 小工具 ---------- */
  var clamp=D.clamp=function(v){return v<0?0:v>1?1:v};
  D.range=function(p,a,b){return clamp((p-a)/(b-a))};
  D.ease=function(t){return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2};
  D.ease3=function(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2};
  D.lerp=function(a,b,t){return a+(b-a)*t};
  D.reduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  D.mobile=function(){return innerWidth<D.BP};
  D.$=function(id){return typeof id==='string'?document.getElementById(id):id};
  var NS='http://www.w3.org/2000/svg';
  D.svg=function(tag,attrs,parent){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;};

  /* ---------- 转场：只做淡出（不缩小，免得看到画面边框） ---------- */
  D.sink=function(stage,k){
    k=clamp(k);
    stage.style.opacity=(1-k).toFixed(3);
    stage.style.visibility=k>=.999?'hidden':''; // 完全透明时不挡住下面那一屏的按钮
  };
  if(!window.__drSink) window.__drSink=D.sink;

  /* ---------- 按钮网址 ---------- */
  D.links=function(root,L){
    if(!root||!L) return;
    root.querySelectorAll('[data-link]').forEach(function(a){var u=L[a.getAttribute('data-link')];if(u)a.href=u;});
  };

  /* ---------- 一句一句的文字 ----------
     SEG = [[开始, 结束], ...]，进度 0~1。opts: fade 淡入长度、dy 位移、center 是否垂直置中（默认是） */
  D.steps=function(els,SEG,p,o){
    o=o||{}; var f=o.fade||.05, dy=o.dy==null?22:o.dy, center=o.center!==false, out=[];
    for(var k=0;k<els.length&&k<SEG.length;k++){
      var a=SEG[k][0],b=SEG[k][1];
      var op=Math.min(D.range(p,a,a+f),1-D.range(p,b-f,b));
      var y=(1-D.range(p,a,a+f))*dy-D.range(p,b-f,b)*dy;
      els[k].style.opacity=op.toFixed(3);
      els[k].style.transform=center?'translateY(calc(-50% + '+y.toFixed(1)+'px))':'translateY('+y.toFixed(1)+'px)';
      els[k].classList.toggle('is-on',op>.5);
      out.push(op);
    }
    return out;
  };

  /* ---------- 一屏：固定画面 + 进度 + 动画循环 ----------
     D.scene({
       root:   'sc-02' 或元素
       stage:  画面元素（默认 root 里的 .drx-stage）
       first:  true = 页面第一屏（滑到顶才固定，进度 = 已滑过的比例）
       early:  提早固定：r.top <= innerHeight * early（默认 1.5）
       sink:   结尾淡出从哪里开始（默认 .955；[a,b] 也可以；false = 不淡出）
       lerp:   跟随速度（默认 .14）
       load:   快到这一屏才执行一次（载图），loadAhead 默认 4 屏
       resize: 画面大小变了要做的事
       frame:  function(p, S){ ... }  每一帧，p 是平滑后的进度
     })
     回传 S：S.p、S.target、S.kick()、S.mobile */
  D.scene=function(o){
    var root=D.$(o.root); if(!root) return null;
    var stage=o.stage||root.querySelector('.drx-stage');
    var S={root:root,stage:stage,p:0,target:0,mobile:D.mobile(),visible:true,running:false};
    var early=o.early==null?1.5:o.early, K=o.lerp||.14, loaded=false;
    var sk=o.sink==null?[.955,1]:o.sink; if(typeof sk==='number') sk=[sk,1];
    S.kick=function(){};
    if(D.reduce){ if(o.load)o.load(); if(o.still)o.still(S); return S; }

    function onScroll(){
      var r=root.getBoundingClientRect(), ih=innerHeight, pin;
      if(o.first){S.target=clamp(-r.top/Math.max(1,r.height-ih));pin=r.top<=0&&r.bottom>ih;}
      else{S.target=clamp((ih-r.top)/r.height);pin=r.top<=ih*early&&r.bottom>ih;}
      stage.classList.toggle('is-pinned',pin);
      stage.classList.toggle('is-after',r.bottom<=ih);
      stage.style.left=pin?r.left+'px':'';stage.style.width=pin?r.width+'px':'';
      if(!loaded&&o.load&&r.top<ih*(o.loadAhead||4)){loaded=true;o.load();}
    }
    function frame(){
      S.p+=(S.target-S.p)*K; if(Math.abs(S.target-S.p)<.0004)S.p=S.target;
      if(o.frame) o.frame(S.p,S);
      if(sk) D.sink(stage,Math.max(D.range(S.p,sk[0],sk[1]),D.range(S.target,sk[0],sk[1])));
      if(S.visible&&S.p!==S.target) requestAnimationFrame(frame); else S.running=false;
    }
    S.kick=function(){if(!S.running&&S.visible){S.running=true;requestAnimationFrame(frame);}};
    S.refresh=function(){S.p=S.target+.001;S.kick();}; // 强制再画一帧

    if(o.resize) o.resize(S);
    onScroll(); S.p=S.target;
    addEventListener('scroll',function(){onScroll();S.kick();},{passive:true});
    addEventListener('resize',function(){
      if(o.reload!==false&&D.mobile()!==S.mobile){location.reload();return;}
      if(o.resize)o.resize(S); onScroll(); S.refresh();
    });
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(e){S.visible=e[0].isIntersecting;S.kick();},{rootMargin:'200% 0px'}).observe(root);
    }
    S.running=true; requestAnimationFrame(frame);
    return S;
  };

  /* ---------- 画布 ---------- */
  D.canvas=function(cv,maxDpr){
    var c={cv:cv,ctx:cv.getContext('2d'),W:0,H:0,dpr:1};
    c.fit=function(){c.dpr=Math.min(window.devicePixelRatio||1,maxDpr||1.5);c.W=cv.clientWidth;c.H=cv.clientHeight;
      cv.width=Math.round(c.W*c.dpr);cv.height=Math.round(c.H*c.dpr);c.ctx.setTransform(c.dpr,0,0,c.dpr,0,0);c.ctx.imageSmoothingQuality='high';};
    c.fit(); return c;
  };

  /* ---------- 影片序列 ----------
     var V=D.frames({ desktop:'.../desktop/', mobile:'.../mobile/', count:100, canvas:cv, dpr:1.5,
                      focus:[图片的x比例, 画面的x比例], focusMobile:[...], zoom:1 });
     载图：V.start()（放在 scene 的 load 里）；每帧：V.draw(0~1)；大小变了：V.resize() */
  D.frames=function(o){
    var mob=D.mobile(), base=mob?o.mobile:o.desktop, N=o.count||100, C=D.canvas(o.canvas,o.dpr||1.5);
    var imgs=new Array(N), ok=new Array(N), started=false, cur=0, lastF=-1;
    function src(i){return base+'f_'+String(i+1).padStart(3,'0')+'.webp';}
    function load(i,cb){var im=new Image();im.decoding='async';
      im.onload=function(){var done=function(){ok[i]=true;if(i===0||Math.abs(i-cur*(N-1))<1.5)draw(cur,true);cb&&cb();};(im.decode?im.decode().then(done,done):done());};
      im.onerror=function(){cb&&cb();};im.src=src(i);imgs[i]=im;}
    function start(){if(started||!base)return;started=true;
      var ORDER=[],seen={0:1};[8,4,2,1].forEach(function(st){for(var i=0;i<N;i+=st)if(!seen[i]){seen[i]=1;ORDER.push(i);}});
      load(0,function(){var next=0,act=0;
        function pump(){while(act<6&&next<ORDER.length){act++;load(ORDER[next++],function(){act--;pump();});}}
        if(!D.reduce)pump();});}
    function place(im){
      var iw=im.naturalWidth,ih=im.naturalHeight,W=C.W,H=C.H;
      if(o.place) return o.place(W,H,iw,ih,mob);
      var s=Math.max(W/iw,H/ih)*(o.zoom||1),dw=iw*s,dh=ih*s,f=(mob?o.focusMobile:o.focus)||[.5,.5];
      var ox=Math.max(W-dw,Math.min(0,W*f[1]-dw*f[0]));
      return [ox,(H-dh)*.5,dw,dh];
    }
    function nearest(i){var j=i,k=i;while(!ok[j]&&!ok[k]&&(j>0||k<N-1)){if(j>0)j--;if(k<N-1)k++;}return ok[j]?j:(ok[k]?k:-1);}
    function paint(im){var r=place(im);C.ctx.drawImage(im,r[0],r[1],r[2],r[3]);}
    function draw(t,force){
      cur=t; if(!C.W) return;
      var f=Math.max(0,Math.min(N-1,t*(N-1)));
      if(!force&&Math.abs(f-lastF)<.02) return;
      var i0=Math.floor(f),i1=Math.min(N-1,i0+1),a=f-i0,j0=nearest(i0); if(j0<0) return;
      C.ctx.clearRect(0,0,C.W,C.H); C.ctx.globalAlpha=1; paint(imgs[j0]);
      if(a>.02&&i1!==i0&&ok[i1]&&ok[i0]){C.ctx.globalAlpha=a;paint(imgs[i1]);C.ctx.globalAlpha=1;}
      lastF=(ok[i0]&&ok[i1])?f:-1;
    }
    return {start:start,draw:draw,resize:function(){C.fit();draw(cur,true);},canvas:C};
  };

  /* ---------- 带刻度的圆圈（SVG） ----------
     D.ticks(g, {cx,cy, r1:内, r2:长刻度外缘, n:刻度数, every:每几格一条长刻度}) */
  D.ticks=function(g,o){
    if(!g) return; var n=o.n||90, ev=o.every||6;
    for(var q=0;q<n;q++){var a=q/n*Math.PI*2,big=q%ev===0,r2=big?o.r2:o.r1+(o.r2-o.r1)*.45;
      var l=D.svg('line',{x1:(o.cx+Math.cos(a)*o.r1).toFixed(1),y1:(o.cy+Math.sin(a)*o.r1).toFixed(1),
        x2:(o.cx+Math.cos(a)*r2).toFixed(1),y2:(o.cy+Math.sin(a)*r2).toFixed(1)},g);
      if(big) l.setAttribute('class','l');}
  };

  /* ---------- 发光的点（先画好一张，之后直接贴图，不用 shadowBlur） ---------- */
  D.glowDot=function(size){
    size=size||32; var c=document.createElement('canvas');c.width=c.height=size;
    var x=c.getContext('2d'),h=size/2,g=x.createRadialGradient(h,h,0,h,h,h);
    g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.18,'rgba(255,244,222,1)');
    g.addColorStop(.42,'rgba(226,186,120,.75)');g.addColorStop(1,'rgba(226,186,120,0)');
    x.fillStyle=g;x.fillRect(0,0,size,size); return c;
  };

  /* ---------- 照片：有网址就放图，没有就显示占位 ---------- */
  D.photo=function(box,url,alt){
    if(!box) return;
    if(url){var im=new Image();im.alt=alt||'';im.loading='lazy';im.decoding='async';im.src=url;box.appendChild(im);box.classList.add('has-img');}
    else box.classList.add('is-empty');
  };

  /* ---------- 点开看大图 ---------- */
  var LB=null;
  D.lightbox=function(url,caption){
    var host=document.getElementById('dr360')||document.body;
    if(!LB){LB=document.createElement('div');LB.className='drx-lb';
      LB.innerHTML='<button class="drx-lb-x" aria-label="关闭">×</button><figure><img alt=""><figcaption></figcaption></figure>';
      LB.addEventListener('click',function(e){if(e.target.tagName!=='IMG')LB.classList.remove('on');});
      addEventListener('keydown',function(e){if(e.key==='Escape')LB.classList.remove('on');});
      host.appendChild(LB);}
    LB.querySelector('img').src=url; LB.querySelector('figcaption').textContent=caption||'';
    LB.classList.add('on');
  };

  /* ---------- 页脚 ----------
     D.footer(元素, { menu:[['组名',[['字','网址'],...]],...], note:'页脚小字' })
     menu 不填就用默认的全站链接 */
  D.FOOT_MENU=[
    ['认识 DR360',[['关于 DR360','#'],['福报事业','#']]],
    ['抗衰项目',[['干细胞再生','#'],['骨龄抗衰','#'],['减脂抗衰','#'],['面部风水','#'],['细胞再生','#'],['肠道排毒抗衰','#'],['私密抗衰','#'],['口腔抗衰','#'],['头疗抗衰','#']]]
  ];
  D.footer=function(el,o){
    el=D.$(el); if(!el) return; o=o||{};
    el.classList.add('drx-foot');
    el.innerHTML='<div class="df-in"><nav class="df-menu" aria-label="网站页面"></nav><div class="df-top">'+
      '<div class="df-col"><p class="df-k">HQ 总部</p><a class="df-v df-sm df-addr" href="https://www.google.com/maps/search/?api=1&amp;query=Sky+Park+One+City+USJ+Subang+Jaya" target="_blank" rel="noopener">'+
        '<span>Sky Park @ One City USJ</span><span>1, F-11-01, Jalan USJ 25/1B,</span><span>One City, 47650 Subang Jaya,</span><span>Selangor, Malaysia</span></a></div>'+
      '<div class="df-col"><p class="df-k">营业时间</p><p class="df-v df-sm">星期一至星期天<br>早上 10 点至晚上 10 点</p></div>'+
      '<div class="df-col"><p class="df-k">电话号码</p><a class="df-v df-tel" href="https://wa.me/60183603601" target="_blank" rel="noopener">+6018 360 3601</a></div>'+
      '<a class="df-fb" href="https://www.facebook.com/dr360.official" target="_blank" rel="noopener" aria-label="DR360 Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h2.5V4.6c-.4-.1-1.9-.2-3.5-.2-3.5 0-5.6 2.1-5.6 6v3H4v3.8h3.4V24h4.2v-6.8h3.3l.5-3.8h-3.8v-2.6c0-1.1.3-2.8 2.4-2.8z"/></svg></a>'+
      '</div><p class="df-note"></p><p class="df-copy">Copyright © 2026 Dr360 | 抗衰医疗医美养生中心</p></div>';
    var nav=el.querySelector('.df-menu');
    (o.menu||D.FOOT_MENU).forEach(function(g){
      var box=document.createElement('div');box.className='df-grp';
      var k=document.createElement('p');k.className='df-k';k.textContent=g[0];box.appendChild(k);
      var wrap=document.createElement('div');wrap.className='df-links';
      g[1].forEach(function(m){var a=document.createElement('a');a.href=m[1]||'#';a.innerHTML='<span></span><i>→</i>';a.firstChild.textContent=m[0];
        if(o.current&&m[0]===o.current)a.className='on';wrap.appendChild(a);});
      box.appendChild(wrap);nav.appendChild(box);});
    var note=el.querySelector('.df-note'); if(o.note) note.textContent=o.note; else note.remove();
  };

  /* ---------- header guard：Systeme 的固定 / 黏顶 header 永远在最上层 ---------- */
  D.headerGuard=function(home){
    if(!home||home.__drGuard) return; home.__drGuard=1;
    function lift(){
      [.1,.5,.9].forEach(function(fx){
        var list=document.elementsFromPoint(innerWidth*fx,8)||[];
        list.forEach(function(el){
          for(var n=el;n&&n!==document.body;n=n.parentElement){
            if(home.contains(n)) return;
            var cs=getComputedStyle(n);
            if(cs.position==='fixed'||cs.position==='sticky'){
              var z=parseInt(cs.zIndex,10); if(isNaN(z)||z<100) n.style.zIndex='1000';
              return;
            }
          }
        });
      });
    }
    // 找的时候先让我们的画面暂时不挡点击检测
    function run(){var st=home.querySelectorAll('.drx-stage');st.forEach(function(e){e.style.pointerEvents='none';});lift();st.forEach(function(e){e.style.pointerEvents='';});}
    run(); addEventListener('load',run); setTimeout(run,1500);
    var t=0; addEventListener('scroll',function(){if(!t){t=setTimeout(function(){run();t=0;},500);}},{passive:true});
  };

  /* ---------- 启动：照顺序执行每一屏 ---------- */
  window.DR360=D;
  function run(f){try{f(D);}catch(e){if(window.console)console.error('[DR360]',e);}}
  var q=window.DR360Q; window.DR360Q={push:run};
  if(q&&q.length) for(var i=0;i<q.length;i++) run(q[i]);
  function guard(){D.headerGuard(document.getElementById('dr360'));}
  if(document.getElementById('dr360')) guard(); else document.addEventListener('DOMContentLoaded',guard);
})();
