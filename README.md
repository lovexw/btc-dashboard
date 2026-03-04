# 🌌 比特币全景看板 (Bitcoin Dashboard - btchao)

> “在区块链的永恒内存中，数据是绝对的真相。Tick tock, next block.”

**在线预览：** [比特币数据看板 - btchao](https://db.btchao.com/) | **所属主站：** [比特囤币](https://www.btchao.com/)

## 📖 故事与初衷 (The Philosophy)

比特币不仅仅是一种资产，它是一个正在运行的、庞大且精密的数字生命体。从内存池中拥挤的交易，到闪电网络中交织的通道，再到深空中计算的星际往返时间，每一个跳动的数字都在诉说着去中心化网络的壮阔。

本项目旨在构建一个**全自动、零干预、纯静态**的比特币中文数据仪表盘。它像是放置在网络边缘的一面镜子，每隔数小时，便会自动倒影出 [Clark Moody Bitcoin Dashboard](https://dashboard.clarkmoody.com/) 的最新全貌，并将其转化为结构化的中文数据，供所有华文世界的比特币信仰者、研究者和 HODLer 们查阅。

没有沉重的后端服务器，没有脆弱的私有 API 依赖。只有优雅的 Serverless 架构和 AI 的智慧。

## ⚙️ 核心架构 (How it Works)

这是一个融合了**无头浏览器爬虫 + AI 大模型数据清洗 + 自动化 CI/CD** 的极客项目。整个架构运行在免费的云端基础设施上，成本几乎为零。

1. **🕵️ 抓取 (Playwright):** 基于 Python 的 Playwright 模拟真实浏览器环境，穿透动态加载与 WebSocket 推送，直接提取网页 DOM 树中的全量纯文本。
2. **🧠 清洗与重构 (DeepSeek AI):** 将杂乱无章的纯文本（包括一维指标与多维复杂表格）喂给 DeepSeek 大语言模型。通过精心设计的系统提示词 (Prompt)，AI 自动剔除广告与无关 UI，将专业术语完美翻译为中文，并输出结构严谨的 `JSON` 数据。
3. **⏱️ 定时引擎 (GitHub Actions):** 使用 GitHub Actions 的 Cron 触发器，每 4 小时自动唤醒一次 Ubuntu 虚拟机，执行上述 Python 脚本，并将生成的 `bitcoin_dashboard_v2_zh.json` 自动 commit 回仓库。
4. **🚀 边缘部署 (Cloudflare Pages):** Cloudflare 监听 GitHub 仓库的变动，一旦发现有新的 commit 数据提交，瞬间触发静态构建，将最新的 HTML 与 JSON 数据分发到全球边缘节点。

## 🛠️ 本地开发与部署 (Setup & Deploy)

如果你希望 Fork 本项目并建立属于你自己的看板，请遵循以下步骤：

### 1. 准备环境
确保你已安装 Python 3.10+，并安装所需依赖：
```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. 配置 AI 密钥
本项目依赖 DeepSeek 的 API 进行数据清洗。请在本地运行前设置环境变量：

```Bash
export DEEPSEEK_API_KEY="sk-你的真实密钥"
```

### 3. GitHub Actions 自动化
Fork 本仓库后，前往仓库的 Settings -> Secrets and variables -> Actions。
添加一个名为 DEEPSEEK_API_KEY 的 Repository Secret，填入你的 API 密钥。GitHub 将会自动接管每 4 小时的更新任务。

### 4. 前端页面 (index.html)
前端采用原生 JavaScript + Tailwind CSS 编写，纯前端解析 JSON 文件并动态生成极简深色的网格卡片与表格。部署至任意静态托管平台（如 Cloudflare Pages, Vercel, GitHub Pages）即可食用。

## 🔌 公开 API 接口 (Public API)

> “代码即法律，数据即共识。”

我们不仅构建了一个前端看板，更希望为整个华文比特币社区提供一个**免费、稳定、纯净的公共基础设施**。

本项目的数据接口已完全开放，且配置了无限制的跨域资源共享（CORS）。无论是你想在自己的博客挂一个比特币价格挂件，还是开发硬核的链上数据小程序，甚至是用单片机做一个实体的比特币时钟，都可以直接、免费地调用本接口。

### 接口详情

* **请求地址 (Endpoint):** `https://db.btchao.com/bitcoin_dashboard_v2_zh.json`
* **请求方式 (Method):** `GET`
* **更新频率 (Frequency):** 每 4 小时自动抓取清洗更新一次（由 GitHub Actions 驱动）
* **跨域支持 (CORS):** `Access-Control-Allow-Origin: *` (支持全网前端跨域直连)
* **调用频控 (Rate Limit):** 无严格限制（由 Cloudflare CDN 全球边缘节点承载流量，请合理使用，善意调用）

### 调用示例 (Usage Examples)

**示例 1：使用 JavaScript / 前端 Fetch**
```javascript
// 直接在你的前端项目中调用，获取最新的中文比特币全景数据
fetch('[https://db.btchao.com/bitcoin_dashboard_v2_zh.json](https://db.btchao.com/bitcoin_dashboard_v2_zh.json)')
  .then(response => response.json())
  .then(data => {
      console.log("当前比特币价格:", data["Markets"]["价格"]);
      console.log("距离下次减半区块数:", data["Halving"]["距离减半区块数"]);
      // 遍历解析更多数据...
  })
  .catch(error => console.error('数据获取失败:', error));
示例 2：使用 Python

Python
import requests

url = "[https://db.btchao.com/bitcoin_dashboard_v2_zh.json](https://db.btchao.com/bitcoin_dashboard_v2_zh.json)"
response = requests.get(url)

if response.status_code == 200:
    bitcoin_data = response.json()
    print(f"🔥 全网可达节点数: {bitcoin_data['Bitcoin Network']['可达比特币节点数']}")
    print(f"⚡ 闪电网络总容量: {bitcoin_data['Lightning Network (Public)']['总容量']}")
示例 3：使用终端 Curl

Bash
curl -s [https://db.btchao.com/bitcoin_dashboard_v2_zh.json](https://db.btchao.com/bitcoin_dashboard_v2_zh.json) | grep "价格"
数据结构预览
返回的数据为纯粹的 JSON 格式，包含了一维指标字典与多维复杂数组（如节点版本列表、闪电通道年份分布等）：

JSON
{
    "Markets": {
        "价格": "$68,510",
        "市值": "$1.37T"
    },
    "Top Node Versions": [
        {
            "版本": "Core 30.0.0",
            "数量": "3,597",
            "百分比": "14.8%"
        }
    ]
    // ... 包含 30+ 个大类，数百项硬核数据
}
🤝 开发者约定： 本接口完全免费开放，不设鉴权。如果这个数据源对你的项目有帮助，欢迎在你的项目中添加一句简单的致谢或带上主站回链（Data provided by btchao.com），这是对开源精神最大的支持。

### 📜 许可证 (License)
本项目前端展示与代码逻辑开源。
致敬 Clark Moody 提供的伟大原始数据面板。
Data validation and insights powered by DeepSeek.

“Set It. Stack It. Forget It.” —— 愿你的冷钱包岁月静好。
