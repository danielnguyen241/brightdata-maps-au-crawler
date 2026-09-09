# SOP Hướng Dẫn Vận Hành Crawler Cho Anh Em Công Ty
## Dành cho Team SEO, Tech & Data Outreach — Bàn giao dự án nhanh trong 5 phút

Tài liệu này là quy trình chuẩn (SOP) dành cho tất cả thành viên trong team khi nhận yêu cầu: *"Cào danh sách doanh nghiệp B2B theo ngành X tại toàn bộ nước Úc hoặc một tiểu bang cụ thể"*.

---

### 1. Chuẩn Bị Môi Trường Làm Việc

1. **Yêu cầu hệ thống:**
   - Đã cài đặt **Node.js phiên bản >= 18.0.0** (Kiểm tra bằng lệnh: `node -v`).
   - Đã cài đặt `curl` (Mac/Linux có sẵn).
   - Không cần cài đặt bất kỳ thư viện ngoài nào qua npm (Zero-dependency!).

2. **Cấu hình API Key Bright Data:**
   - Tạo file chứa API key tại thư mục cá nhân:
     ```bash
     mkdir -p ~/.config/brightdata
     nano ~/.config/brightdata/hairfolli_api_keys
     ```
   - Dán API key vào (mỗi dòng 1 key nếu có nhiều tài khoản).
   - Khoá quyền truy cập để bảo mật:
     ```bash
     chmod 600 ~/.config/brightdata/hairfolli_api_keys
     ```
   - Hoặc đơn giản tạo file `.env` ngay trong thư mục dự án:
     ```bash
     BRIGHTDATA_API_KEY=your_brightdata_api_key_here
     ```

---

### 2. Cách Tạo Dự Án Mới Cho Khách Hàng Khác

Mỗi dự án chỉ khác nhau ở **Từ khoá (keyword)** và **Ngành nghề lọc (categories)**. Anh em không cần sửa code cốt lõi, chỉ cần tạo 1 file preset trong `config/presets/`.

Ví dụ nhận dự án mới: **Cào phòng khám nha khoa (Dental Clinics)**
Tạo file `config/presets/dental.json`:
```json
{
  "name": "Dental Clinics & Dentists Australia",
  "keyword": "dentist",
  "category_keywords": [
    "dentist",
    "dental clinic",
    "cosmetic dentist",
    "orthodontist",
    "dental implants provider"
  ],
  "exclude_categories": [
    "dental supply store",
    "dental school"
  ],
  "require_website": true,
  "default_waves": [1, 2, 3, 4]
}
```

---

### 3. Quy Trình Chạy Chuẩn 4 Bước

#### Bước 1: Kiểm tra cấu hình và toạ độ (Dry-Run — Miễn phí 100%)
Lệnh này kiểm tra danh sách thành phố, toạ độ, số lượng điểm quét mà **không gửi request tính tiền**:
```bash
node src/cli.mjs crawl --preset dental --dry-run
```

#### Bước 2: Chạy thử nghiệm 1 địa điểm (Smoke Test)
Chạy thử duy nhất 1 địa điểm (Sydney CBD) để kiểm tra Bright Data key có hoạt động mượt mà không:
```bash
node src/cli.mjs crawl --preset dental --max-locations 1
```
Kiểm tra thấy báo `✓ Successfully saved snapshot` là tài khoản ngon lành!

#### Bước 3: Chạy cào toàn quốc (hoặc theo tiểu bang)
- **Chạy toàn bộ nước Úc (Full 38 điểm trọng điểm):**
  ```bash
  node src/cli.mjs crawl --preset dental
  ```
- **Hoặc chỉ cào tiểu bang New South Wales (NSW):**
  ```bash
  node src/cli.mjs crawl --preset dental --state NSW
  ```
- **Hoặc chỉ cào các thành phố lớn (Wave 1 và Wave 3):**
  ```bash
  node src/cli.mjs crawl --preset dental --waves 1,3
  ```

*(Lưu ý: Nếu đang chạy mà máy bị tắt hoặc mạng rớt, anh em chỉ cần gõ lại đúng lệnh trên, hệ thống sẽ tự động chạy tiếp các điểm còn lại, không cào lại các điểm đã xong!)*

#### Bước 4: Chạy toàn bộ Pipeline xử lý dữ liệu và cào Email
Sau khi cào Maps xong (hoặc muốn chạy trọn gói từ A-Z một lệnh duy nhất):
```bash
node src/cli.mjs run --preset dental
```
Hệ thống sẽ tự động thực hiện:
1. `crawl`: Quét toạ độ Google Maps.
2. `process`: Lọc bỏ tiệm đóng cửa, loại bỏ trùng lặp (Dedupe), chấm điểm Trust Tier (A+, A, B, C, D, E) theo review count, tính khoảng cách đến CBD.
3. `emails`: Tự động cào website doanh nghiệp tìm email sạch (0 đồng chi phí).
4. `export`: Xuất 2 file CSV và 1 file báo cáo tổng hợp.

---

### 4. Kết Quả Bàn Giao Cho Khách Hàng / Ban Giám Đốc

Toàn bộ kết quả sẽ nằm trong thư mục `reports/<preset-name>-<ngày-chạy>/`:

1. **`master-leads-all.csv`**:
   - Chứa toàn bộ danh sách doanh nghiệp đạt chuẩn (Tên tiệm, Số điện thoại, Website, Địa chỉ, Xếp hạng sao, Số lượt review, Khoảng cách tới CBD, Google Maps URL, Email nếu có).
   - Dùng để báo cáo quy mô thị trường hoặc cho đội Telesales gọi điện.

2. **`outreach-ready-emails.csv`**:
   - Danh sách tinh lọc chỉ gồm những doanh nghiệp **đã có email liên hệ đã qua kiểm định sạch**.
   - Sẵn sàng nạp thẳng vào các phần mềm Email Cold Outreach (Instantly, Lemlist, Woodpecker, Brevo) mà không lo bị bounce hoặc dính spam trap.

3. **`dashboard-summary.json`**:
   - File tổng kết số liệu báo cáo nhanh: Tổng số tiệm, tỷ lệ có website, tỷ lệ có số điện thoại, tỷ lệ tìm thấy email, phân bổ Trust Tier.

---

### 5. Xử Lý Các Sự Cố Thường Gặp (Troubleshooting)

| Vấn đề | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Bright Data HTTP 400: Customer is not active` | Key mới tạo là key của SERP API hoặc Web Unlocker, chưa kích hoạt dịch vụ Google Maps Dataset. | Vào Bright Data Console -> Datasets -> Enable dịch vụ hoặc dùng key có quyền Dataset. |
| `Bright Data HTTP 402: Insufficient balance` | Key đã dùng hết credit trong tài khoản. | Thêm key mới vào `~/.config/brightdata/hairfolli_api_keys` hoặc đổi key trong `.env`. Chạy lại lệnh, crawler sẽ tự resume từ vị trí đang dừng. |
| Một số website không tìm thấy email | Website doanh nghiệp làm bằng Landing Page tĩnh không để mail, hoặc chỉ dùng contact form. | Đây là thực tế tự nhiên của thị trường Úc (tỷ lệ email thường đạt 40% - 60%). Có thể dùng số điện thoại từ `master-leads-all.csv` để telesales hoặc nhắn SMS. |
| Muốn đổi từ khoá nhanh mà không tạo preset file | Dùng tham số `--keyword` trực tiếp trên terminal. | Ví dụ: `node src/cli.mjs run --keyword "car repair" --waves 1` |
