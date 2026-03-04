from playwright.sync_api import sync_playwright
from openai import OpenAI
import json
import time
import os

# 从环境变量中读取 API Key，不要写死在代码里
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

if not DEEPSEEK_API_KEY:
    raise ValueError("未找到 DEEPSEEK_API_KEY 环境变量！")

def fetch_raw_text_from_v2_dashboard():
    print("正在启动无头浏览器，前往 Clark Moody V2 看板...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 改为 V2 版本的全新网址
        page.goto("https://dashboard.clarkmoody.com/")
        
        # V2 版本加载项较多，等待 8 秒确保所有数据渲染完毕
        print("等待 WebSocket 数据和表格加载 (8秒)...")
        time.sleep(8) 
        
        # 顺手拍一张全页面快照，方便你核对数据
        page.screenshot(path="dashboard_v2_verify.png", full_page=True)
        print("已保存网页快照到 dashboard_v2_verify.png，抓取结束后可用于核对！")
        
        # 直接抓取整个网页 body 的所有纯文本，简单粗暴防漏抓
        raw_text = page.locator("body").inner_text()
        
        browser.close()
        print("抓取完成！文本长度:", len(raw_text))
        return raw_text

def process_with_deepseek(raw_text):
    print("正在呼叫 DeepSeek 进行高难度表格解析与翻译...")
    
    client = OpenAI(
        api_key=DEEPSEEK_API_KEY, 
        base_url="https://api.deepseek.com"
    )

    # 针对 V2 版本的终极 Prompt
    system_prompt = """
    你是一个专业的数据清洗专家和比特币行业翻译。
    我会给你一段从最新的 Clark Moody Bitcoin Dashboard V2 版上抓取的全量纯文本。
    这个看板包含了单行指标，也包含了极其复杂的【表格型/列表型】数据（例如：Top Node Versions, Lightning Channel Vintage, Largest Lightning Nodes, Ashigaru Pools 等）。

    你的任务是：
    1. 提取出所有的指标和表格数据，做到 100% 无遗漏。
    2. 将英文的指标名称、表头全部翻译成专业、地道的中文。
    3. 数据结构严格要求：
       - 对于基础的单一指标，使用结构化的字典（Key-Value），例如 {"价格": "$68,430"}。
       - 对于表格型、列表型数据，必须使用 JSON 数组（Array of Objects）来完整保留其多行多列的结构，绝不能压缩成一行。例如 [{"版本": "Core 30.0.0", "数量": "3,597"}, ...]
    4. 自动过滤杂质：坚决忽略网页上的无关 UI 元素，如：“Sign in with Nostr”、“Donate”、“Favorites”、具体的外部新闻标题（如 "The Rage News" 或 "No BS Bitcoin News" 里的文章内容）、以及页脚的版权声明。
    5. 严格只输出合法的 JSON 格式，绝不包含任何额外的解释文本或 Markdown 代码块标记（千万不要输出 ```json 这样的符号）。
    """

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"这是抓取到的 V2 看板原始文本，请处理：\n{raw_text}"}
        ],
        response_format={"type": "json_object"}, 
        temperature=0.1 
    )

    return response.choices[0].message.content

if __name__ == "__main__":
    text_data = fetch_raw_text_from_v2_dashboard()
    
    if text_data:
        result_json_str = process_with_deepseek(text_data)
        
        print("\n--- DeepSeek V2 数据处理完毕 ---")
        try:
            parsed_json = json.loads(result_json_str) 
            print("成功解析 JSON！共提取了", len(parsed_json), "个主分类。")
            
            # 存入本地文件
            with open("bitcoin_dashboard_v2_zh.json", "w", encoding="utf-8") as f:
                json.dump(parsed_json, f, indent=4, ensure_ascii=False)
            print("终极版数据已保存至 bitcoin_dashboard_v2_zh.json！")
            
        except json.JSONDecodeError as e:
            print("JSON 解析失败，DeepSeek 返回的可能不是纯 JSON。原返回内容如下：")
            print(result_json_str)