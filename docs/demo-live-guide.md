# Genius X Demo 演示指南(真实互动版)

> 本地跑通第一课的完整三角色课堂(学生 / 助教 / 教师投影)。当前为**确定性模拟引擎**
> ——AI 响应是预置内容,无需任何真实供应商密钥;真实 AI 接入是 Phase 7(待外部资源)。

## 概览

- **学生端**:扫码/链接进入课堂,语音/涂鸦交互,看伙伴诞生
- **助教控制面**:解锁场景、推进环节、必要时强制推进、确认投屏
- **教师投影**:大屏展示当前场景与孩子作品

所有 AI 调用走唯一网关并返回预置兜底——演示中永远不会出现报错画面。

## 前置条件

```bash
pnpm install
docker compose up -d postgres                     # 身份/工作区持久化(必需;缺少会 503 IDENTITY_UNAVAILABLE)
pnpm --filter @genius-x/server migrate:seed       # 迁移 001-009 + 演示数据(ALLOW_SEED=1)
```

> 加入方式说明:Phase 1 起学生**不再手输姓名进房间**——学生身份由报名预先创建,
> 通过带 `?studentId=…` 的报名链接加入(`demo-start.sh` 会打印种子学生的链接)。
> 客户端提交的名字会被忽略,以服务端身份为准。

## 启动

```bash
./demo-start.sh        # 一键启动 server(:3000)+ web(:5173),并打印学生报名链接
```

或手动分两个终端:

```bash
# 终端 1:后端
pnpm --filter @genius-x/server dev      # http://localhost:3000

# 终端 2:前端
pnpm --filter @genius-x/web dev         # http://localhost:5173
```

## 三个浏览器标签页

| 角色 | 地址 |
| --- | --- |
| 助教控制面 | `http://localhost:5173/?role=assistant` |
| 学生端 | `demo-start.sh` 打印的报名链接(形如 `http://localhost:5173/?studentId=…`) |
| 教师投影 | `http://localhost:5173/?role=teacher` |

## 演示流程

1. **助教**打开控制面 → 看到已加入的学生 → 解锁第一个场景
2. **学生**端场景亮起 → 按引导式选项交互(语音/涂鸦/选择)→ 伙伴回应(预置兜底,带"思考中"动画)
3. **助教**逐场景推进;某个孩子卡住时用「强制推进」防止全班等待
4. 走到诞生礼场景 → 学生看到自己专属伙伴的诞生(出生证 = 形象 v1 快照)
5. **教师投影**可展示当前场景与孩子作品(投屏由助教确认)
6. 课程结束 → 服务端写回档案 + 记忆固化 + 伙伴日记 + 家长分享链接(控制台打印)

## 真实互动的技术要点

- **状态实时同步**:任一端解锁场景,全班 ≤0.5 秒同步;刷新/断网重连恢复到当前场景
- **降级不可见**:AI 任一能力超时即切预置兜底,孩子无感、运营侧有计数
- **记忆连贯**:场景内多轮接续;跨课伙伴记得上次的事(本地多课演示可验证)

## 课后乐园(可选)

家长面与课后乐园已交付(v0 零 AI 地板):
- 家长主页:`http://localhost:5173/?parent=<token>`(token 由运营 mint 接口生成)
- 课后乐园:家长面「把屏幕交给孩子」按钮 → `?playground=<session token>`

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 加入返回 503 `IDENTITY_UNAVAILABLE` | PostgreSQL 未起或未 seed:`docker compose up -d postgres` + `migrate:seed` |
| 学生端停在欢迎引导、无加入表单 | 正常——用 `demo-start.sh` 打印的 `?studentId=` 链接进入,不是手输姓名 |
| AI 响应像"复读" | 预期——当前是确定性模拟引擎(FakeProvider);真实 AI 是 Phase 7 |
| 局域网用手机/iPad 测试 | Vite 已配 `host: 0.0.0.0`;用本机局域网 IP 访问 `http://<IP>:5173` |

## 真实 AI 接入(Phase 7,待外部资源)

供应商适配层是唯一换装点(图像已按异步提交→轮询的真实 API 形态建模)。接入腾讯
混元/TTS/天御审核后,业务代码零改动即点亮;详见
[`DEFERRED.md`](DEFERRED.md)(DF-1 / DF-2 / DF-v2-22)与
[`architecture/capacity-and-latency.md`](architecture/capacity-and-latency.md)。
