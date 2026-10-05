import os
import sys
import json
from pathlib import Path

# Load artemis environment
root = Path("/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis")
sys.path.insert(0, str(root))

from artemis.config.settings import settings
from artemis.llm.router import ModelEndpoint, ModelFactory, ModelProvider
from langchain_core.messages import HumanMessage, SystemMessage

def main():
    material_context = {
        "drama_title": "The Hidden Heiress Strikes Back (真假千金逆袭录)",
        "episode": 1,
        "clip_duration": "2m16s",
        "aspect_ratio": "9:16 vertical short video",
        "genre": "Billionaire Romance / Revenge / Identity Reversal",
        "target_audience": "North America & Southeast Asia (English-speaking)",
        "target_platform": "Facebook Page (Tongm Mhuo 短剧精选)",
        "marketing_goal": "High viral completion rate, suspense hook, traffic drive to full series"
    }

    system_prompt = """You are SocialGrowth's Senior AI Short Drama Content Strategist.
Your job is to generate high-performing, viral, and culturally adapted social media publishing copy for short drama clips.
Do NOT use rigid generic templates. Analyze the drama's specific genre, emotional hook points, and target audience.

Output valid JSON only with the following fields:
{
  "creative_hook": "The punchy first-3-seconds hook sentence",
  "post_title": "Catchy headline for the post",
  "caption": "Compelling storyline description that creates an irresistible cliffhanger (150-250 words)",
  "hashtags": ["list", "of", "trending", "hashtags"],
  "cta_text": "Strong call to action directing viewers to link in bio / comments for next episode",
  "full_formatted_text": "The complete ready-to-publish Facebook caption including title, story, CTA and hashtags"
}"""

    provider = "openai" if settings.OPENAI_BASE_URL else os.environ.get("ARTEMIS_LLM_PROVIDER") or "openai"
    endpoint = ModelEndpoint(
        provider=ModelProvider.from_string(provider),
        model_name=settings.ARTEMIS_DEFAULT_MODEL or "gemini-3.8-flash",
        timeout_seconds=30,
        temperature=0.7,
        max_tokens=1500
    )
    model = ModelFactory.get_model(endpoint)

    user_prompt = f"Generate the viral publishing strategy for this short drama clip:\n{json.dumps(material_context, indent=2, ensure_ascii=False)}"
    response = model.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])
    content = response.content.strip()

    # Parse and validate JSON
    if content.startswith("```json"):
        content = content[7:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    parsed = json.loads(content)
    print(json.dumps(parsed, indent=2, ensure_ascii=False))

    out_file = Path("/Users/linghuxj/Documents/myproject/project/SocialGrowth/artifacts/acceptance/product/ai-strategy/01-ai-generated-strategy.json")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps({
        "input_material": material_context,
        "ai_strategy": parsed,
        "model": str(endpoint.model_name),
        "provider": str(endpoint.provider)
    }, indent=2, ensure_ascii=False))
    print(f"\n✔ AI Strategy successfully generated and saved to {out_file}")

if __name__ == "__main__":
    main()
