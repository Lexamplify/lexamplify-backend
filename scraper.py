from playwright.sync_api import sync_playwright
import json
import time
import random
import os

BASE_DOMAIN = "https://ecourts.gov.in"
START_URL = f"{BASE_DOMAIN}/ecourts2.0/?p=dist_court"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")

def scrape_ecourts_v2():
    print("🚀 Starting Amnesia-Mode eCourts Scraper...")
    database = {}

    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)

        # ==========================================
        # STEP 1: INITIAL RECON (Get State Names)
        # ==========================================
        print(f"📡 Connecting to Main Portal for Recon...")
        recon_context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        recon_page = recon_context.new_page()
        recon_page.goto(START_URL, wait_until="domcontentloaded", timeout=60000)

        recon_page.wait_for_selector("select#sateist", timeout=15000)
        state_options = recon_page.locator("select#sateist option").all()

        states = []
        for opt in state_options:
            text = opt.inner_text().strip()
            if text and "Select" not in text:
                states.append(text)

        print(f"🗺️ Found {len(states)} States. Closing recon session...")
        recon_context.close()

        # ==========================================
        # STEP 2: ISOLATED EXTRACTION LOOP
        # ==========================================
        for state_name in states:
            database[state_name] = []
            print(f"⏳ Extracting: {state_name}...")

            # Create a brand new, clean session for EVERY state
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1920, "height": 1080}
            )
            page = context.new_page()
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            try:
                page.goto(START_URL, wait_until="domcontentloaded", timeout=45000)
                time.sleep(random.uniform(1.0, 2.0))

                # RED TEAM PATCH: Safely await the hard JS redirect
                with page.expect_navigation(timeout=45000):
                    page.select_option("select#sateist", label=state_name)

                # Wait for District dropdown to attach to DOM
                page.wait_for_selector("select#sateist option:has-text('District')", state="attached", timeout=25000)

                # Extract districts
                district_options = page.locator("select#sateist option").all()

                for dist in district_options:
                    dist_name = dist.text_content().strip()
                    dist_val = dist.get_attribute("value")

                    if dist_val and "Select" not in dist_name and dist_val != "":
                        clean_val = dist_val.lower().replace(" ", "")
                        constructed_url = f"https://{clean_val}.dcourts.gov.in/"

                        database[state_name].append({
                            "name": dist_name,
                            "url": constructed_url
                        })

                print(f"   ✅ Saved {len(database[state_name])} districts.")

            except Exception as e:
                print(f"   ⚠️ ERROR on {state_name}: {str(e)}. Skipping...")

            finally:
                context.close()

            # Incremental backup
            with open(os.path.join(DATA_DIR, "districts_backup.json"), "w", encoding="utf-8") as f:
                json.dump(database, f, indent=4)

            # RED TEAM PATCH: IP Rate-Limit Cooldown
            time.sleep(random.uniform(2.5, 4.5))

        print("🛑 Extraction complete. Closing browser...")
        browser.close()

    # Final Save
    with open(os.path.join(DATA_DIR, "districts.json"), "w", encoding="utf-8") as f:
        json.dump(database, f, indent=4)

    print("\n🎉 V2 EXTRACTION COMPLETE! Data safely stored.")

if __name__ == "__main__":
    scrape_ecourts_v2()
