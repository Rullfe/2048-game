//SHA256密码哈希
async function sha256(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

//JWT工具函数 Worker WebCrypto实现
function base64UrlEncode(str){
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function base64UrlDecode(str){
    str = str.replace(/-/g,'+').replace(/_/g,'/');
    while(str.length%4) str+='=';
    return atob(str);
}

async function jwtSign(payload, secret){
    const header = JSON.stringify({alg:"HS256",typ:"JWT"});
    const data = `${base64UrlEncode(header)}.${base64UrlEncode(JSON.stringify(payload))}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const sigBuf = await crypto.subtle.sign("HMAC",key,enc.encode(data));
    const sig = base64UrlEncode(String.fromCharCode(...new Uint8Array(sigBuf)));
    return `${data}.${sig}`;
}

async function jwtVerify(token,secret){
    try{
        const parts = token.split(".");
        if(parts.length!==3) return null;
        const [headerB64,payloadB64,signB64] = parts;
        const data = `${headerB64}.${payloadB64}`;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
        const sigRaw = Uint8Array.from([...base64UrlDecode(signB64)].map(c=>c.charCodeAt(0)));
        const ok = await crypto.subtle.verify("HMAC",key,sigRaw,enc.encode(data));
        if(!ok) return null;
        const payload = JSON.parse(base64UrlDecode(payloadB64));
        //过期时间校验 24小时有效期
        if(payload.exp && Date.now()>payload.exp) return null;
        return payload;
    }catch(e){
        return null;
    }
}

//解析Bearer token
async function getAuthUser(request,env){
    const auth = request.headers.get("Authorization");
    if(!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const payload = await jwtVerify(token,env.JWT_SECRET);
    if(!payload || !payload.username) return null;
    return payload.username;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    };
    if(request.method === "OPTIONS") return new Response(null,{headers:corsHeaders});
    const url = new URL(request.url);

    //全局排行榜
    if(url.pathname === "/api/rank"){
      let raw = await env.RANK_KV.get("top2048");
      let rankList = raw ? JSON.parse(raw) : [];
      return Response.json(rankList, {headers:corsHeaders})
    }

    //注册
    if(url.pathname === "/api/register" && request.method==="POST"){
      const body = await request.json();
      const username = (body.username||"").trim();
      const password = body.password;
      if(!username||!password) return Response.json({success:false,msg:"用户名密码不能为空"},{headers:corsHeaders})
      if(username.length>16) return Response.json({success:false,msg:"用户名最多16字符"},{headers:corsHeaders})
      const userKey = `user:${username}`;
      const exist = await env.RANK_KV.get(userKey);
      if(exist) return Response.json({success:false,msg:"该用户名已被注册"},{headers:corsHeaders})
      const passHash = await sha256(password);
      const userData = {passHash, bestScore:0, records:[]};
      await env.RANK_KV.put(userKey, JSON.stringify(userData));
      return Response.json({success:true,msg:"✅账号注册成功，可以登录"},{headers:corsHeaders})
    }

    //登录签发JWT（24h有效期）
    if(url.pathname === "/api/login" && request.method==="POST"){
      const body = await request.json();
      const username = (body.username||"").trim();
      const password = body.password;
      const userKey = `user:${username}`;
      const rawUser = await env.RANK_KV.get(userKey);
      if(!rawUser) return Response.json({success:false,msg:"用户不存在"},{headers:corsHeaders})
      const user = JSON.parse(rawUser);
      const hash = await sha256(password);
      if(hash !== user.passHash) return Response.json({success:false,msg:"密码错误"},{headers:corsHeaders})
      //签发token 24小时过期
      const payload = {username, exp:Date.now()+1000*60*60*24};
      const token = await jwtSign(payload, env.JWT_SECRET);
      return Response.json({success:true,msg:"✅登录成功",token,username},{headers:corsHeaders})
    }

    //校验token有效性
    if(url.pathname === "/api/verify"){
      const uname = await getAuthUser(request,env);
      if(!uname) return Response.json({success:false,msg:"登录已失效"},{headers:corsHeaders})
      return Response.json({success:true,username:uname},{headers:corsHeaders})
    }

    //提交分数（JWT鉴权）
    if(url.pathname === "/api/submit" && request.method==="POST"){
      const username = await getAuthUser(request,env);
      if(!username) return Response.json({success:false,msg:"身份验证失败，请重新登录"},{headers:corsHeaders})
      const body = await request.json();
      const score = Number(body.score)||0;
      const userKey = `user:${username}`;
      const rawUser = await env.RANK_KV.get(userKey);
      if(!rawUser) return Response.json({success:false,msg:"账号不存在"},{headers:corsHeaders})
      const user = JSON.parse(rawUser);
      const nowTime = new Date().toLocaleString("zh-CN");
      //保存本局记录，最多保存最近30条对局
      user.records.unshift({score,time:nowTime});
      if(user.records.length>30) user.records = user.records.slice(0,30);
      //更新个人最高分
      if(score>user.bestScore) user.bestScore = score;
      await env.RANK_KV.put(userKey,JSON.stringify(user));

      //更新全局排行榜
      let rankRaw = await env.RANK_KV.get("top2048");
      let arr = rankRaw ? JSON.parse(rankRaw) : [];
      arr = arr.filter(x=>x.username!==username);
      arr.push({username,score:user.bestScore});
      arr = arr.sort((a,b)=>b.score - a.score).slice(0,20);
      await env.RANK_KV.put("top2048",JSON.stringify(arr));
      return Response.json({success:true,msg:`✅提交完成！个人最高分：${user.bestScore}`},{headers:corsHeaders})
    }

    //读取个人对局记录
    if(url.pathname === "/api/myrecord"){
      const username = await getAuthUser(request,env);
      if(!username) return Response.json({success:false,msg:"请登录"},{headers:corsHeaders})
      const userKey = `user:${username}`;
      const rawUser = await env.RANK_KV.get(userKey);
      const user = JSON.parse(rawUser);
      return Response.json({success:true,bestScore:user.bestScore,records:user.records},{headers:corsHeaders})
    }

    return Response.json({msg:"404接口不存在"},{headers:corsHeaders})
  }
  }
