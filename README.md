# 2048完整版 Cloudflare Pages + Worker + KV + JWT鉴权
## 🎯完整功能清单
1. 用户注册账号，密码SHA256哈希存储，**不保存明文密码**
2. JWT身份令牌登录，有效期24小时；刷新页面自动保持登录状态
3. 后端鉴权：提交分数必须携带有效JWT，防止伪造用户名刷分
4. 每个账号保存个人最高分 + 最近30条对局历史记录
5. 全局排行榜Top20，只展示账号最高分
6. 电脑方向键、手机触屏滑动游玩
7. 前端LocalStorage保存JWT令牌

## 🚀部署步骤
### 1. Worker后端配置
1. 使用原有KV命名空间`RANK_KV`，无需新建
2. Worker后台 → 设置 → **环境变量**
新建密钥变量：
- 变量名：`JWT_SECRET`
- 值：自己生成一串随机复杂字符串（务必保密，不要泄露）
3. 上传新的`worker/index.js`代码，重新部署Worker

> 两种部署方式
> A：wrangler deploy命令部署
> B：Cloudflare网页编辑器直接粘贴全部index.js代码部署

### 2. Cloudflare Pages前端
1. 将`frontend/index.html`上传github仓库
2. 修改代码最上方`WORKER_URL`为你的worker访问域名
3. Pages构建输出目录设置：`frontend`，github自动触发部署

## ⚠️重要注意事项
1. `JWT_SECRET`密钥**千万不要写进代码上传github**，只放在Cloudflare后台环境变量
2. JWT有效期24小时，过期后需要重新登录
3. 用户对局记录最多保存最近30条
4. 全局排行榜只保留每个用户的最高分，取前20位
5. 本项目为小游戏演示，**不适合正式商用**，无验证码、无防暴力注册爆破

## 接口清单
- POST /api/register 注册账号
- POST /api/login 登录，返回JWT token
- GET /api/verify 校验token登录状态
- POST /api/submit 提交本局分数（Authorization携带Bearer JWT）
- GET /api/myrecord 获取个人最高分与对局记录
- GET /api/rank 获取全局排行榜Top20
