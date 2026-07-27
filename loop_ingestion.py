import os
import subprocess
import sys
import time

# 1. Full sequential year range: 2026 down to 1950 (includes 2025 and 2024)
years_to_process = list(range(2026, 1949, -1))

MAX_CONSECUTIVE_FAILURES = 3


def run_all_years():
  print(f"🚀 Starting Multi-Year Ingestion for {len(years_to_process)} years...")

  successful_years = []
  failed_years = []
  consecutive_failures = 0

  for year in years_to_process:
    print(f"\n{'='*60}")
    print(f"📅 STARTING INGESTION FOR YEAR: {year}")
    print(f"{'='*60}")

    env = os.environ.copy()
    env["TARGET_YEAR"] = str(year)

    try:
      # Use sys.executable to ensure worker uses the active venv/Python interpreter
      subprocess.run([sys.executable, "worker.py"], env=env, check=True)
      print(f"✅ Year {year} completed successfully!")

      successful_years.append(year)
      consecutive_failures = 0  # Reset failure counter on success

      time.sleep(5)

    except subprocess.CalledProcessError as e:
      consecutive_failures += 1
      failed_years.append(year)
      print(
          f"❌ FATAL ERROR processing year {year}. Script exited with code"
          f" {e.returncode}"
      )

      # Fail-fast check to prevent long cascading failures
      if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
        print(
            f"\n🚨 ABORTING: {consecutive_failures} consecutive failures"
            " detected. Check network/database connectivity."
        )
        break

      print("⚠️ Skipping to next year in 15 seconds to keep pipeline alive...")
      time.sleep(15)

    except KeyboardInterrupt:
      print("\n🛑 Pipeline manually interrupted by user. Exiting...")
      sys.exit(130)

  # Final Audit Summary
  print(f"\n{'='*60}")
  print("📊 INGESTION SUMMARY REPORT")
  print(f"{'='*60}")
  print(f"✅ Succeeded ({len(successful_years)}): {successful_years}")
  print(f"❌ Failed ({len(failed_years)}): {failed_years}")


if __name__ == "__main__":
  run_all_years()