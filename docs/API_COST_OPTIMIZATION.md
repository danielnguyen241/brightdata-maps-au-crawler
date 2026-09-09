# Sách Trắng Tối Ưu Chi Phí Bright Data (Google Maps Crawler)
## Chiến Lược Tiết Kiệm API Key & Vận Hành Bền Vững Cho Agency

Tài liệu này đúc kết toàn bộ kinh nghiệm thực chiến từ dự án **Hairfolli Australia** (cào full Salon tóc nước Úc) và các dự án B2B Lead Gen tiếp theo của HiAgency. Mục tiêu là giúp anh em công ty cào hàng chục nghìn dữ liệu Google Maps sạch với **chi phí thấp nhất hoặc tận dụng tối đa các tài khoản Free Trial (5,000 credits) mà không bao giờ bị charge thẻ bất ngờ**.

---

### 1. Bản Chất Các Loại API Của Bright Data & Tại Sao Chọn Dataset API?

Khi cào Google Maps, Bright Data cung cấp nhiều giải pháp khác nhau. Chọn sai giải pháp sẽ đốt tiền cực nhanh:

| Giải pháp | Cơ chế tính phí | Nhược điểm khi cào Maps | Đánh giá |
|---|---|---|---|
| **SERP API** | Tính tiền theo từng HTTP Request gửi lên | Mỗi lần search chỉ ra tối đa 20 kết quả Maps. Muốn lấy 200 kết quả phải paginate 10 trang = tốn 10 requests. Thường xuyên bị drop các trường rating, cid, open hours. | ❌ Tốn kém, dễ thiếu data |
| **Scraping Browser / Web Unlocker** | Tính phí theo dung lượng GB hoặc số lượt render trình duyệt | Cực kỳ tốn kém khi render Maps JS nặng. Dễ timeout, ngốn RAM máy và chi phí cao gấp 5-10 lần. | ❌ Không phù hợp cho data diện rộng |
| **Google Maps Dataset API** (`gd_m8ebnr0q2qlklc02fz`) | **Tính tiền theo số bản ghi thực tế trả về (Record Delivered) hoặc per job** | Chạy bất đồng bộ (Trigger -> Poll -> Download JSON). Trả về **toàn bộ 100% metadata** (Place ID, CID, Phone, Website, Category, Review count, Rating, Address, Lat/Long). | 🏆 **Lựa chọn tối ưu số 1** |

---

### 2. Sáu Trụ Cột Tiết Kiệm API Key & Tránh Bị Charge Thẻ

#### Trụ cột 1: Ngưỡng an toàn 4,500 records cho tài khoản Free Trial
- Các tài khoản Bright Data tạo mới thường có **5,000 free credits**.
- Sai lầm phổ biến là để crawler chạy đến 5,000. Khi vượt ngưỡng dù chỉ 1 record, hệ thống tự động trừ tiền qua thẻ tín dụng đã liên kết.
- **Giải pháp của Crawler:** Cài đặt cứng `per_key_cap: 4500` (để dành 500 records làm buffer an toàn). Khi key chạm mốc 4,500 records, crawler lập tức ngắt hoặc tự động đảo sang key tiếp theo trong pool.

#### Trụ cột 2: Chiến lược lưới toạ độ (Coordinate Grid) & Zoom Level chuẩn
Google Maps giới hạn cứng khoảng 200 - 350 kết quả cho mỗi cụm toạ độ tìm kiếm.
- **Nếu zoom quá rộng (`zoom <= 10`):** Google Maps chỉ trả về tối đa 300 địa điểm nổi tiếng nhất của cả bang/thành phố lớn. Toàn bộ các tiệm ở vùng ven hoặc tiệm nhỏ sẽ bị nuốt mất (mất 70% data).
- **Nếu zoom quá sâu (`zoom >= 16`):** Bán kính quét quá hẹp (vài trăm mét), bạn phải tạo hàng nghìn điểm quét -> đốt sạch API key cho những khu dân cư không có doanh nghiệp.
- **Quy chuẩn tối ưu đã được kiểm chứng tại Úc:**
  - **Khu vực trung tâm dày đặc (CBD Sydney, Melbourne CBD, Parramatta):** Dùng `zoom: 14` (bán kính quét ~2.5 - 3.5 km).
  - **Khu vực đô thị mở rộng & Regional Hubs (Central Coast, Wollongong, Newcastle, Geelong):** Dùng `zoom: 13` (bán kính quét ~6 - 8 km).
  - Hệ thống chia làm **4 Waves địa lý**, cho phép quét theo thứ tự ưu tiên thị trường thay vì quét tràn lan.

#### Trụ cột 3: Động cơ Checkpoint nguyên tử (`crawl-state.json`) — "Không bao giờ trả tiền 2 lần"
- Mạng có thể đứt, máy tính có thể hết pin, Bright Data có thể delay response.
- Nếu không có checkpoint, khi chạy lại anh em sẽ phải trigger lại từ đầu -> **mất trắng tiền cào những thành phố trước đó**.
- Trong crawler này, mỗi điểm quét đều được lưu trạng thái nguyên tử (`pending` -> `running` -> `complete`).
- Khi hoàn thành, snapshot được tải về lưu cứng tại thư mục `snapshots/<location_id>.json`.
- Khi khởi động lại, crawler tự động bỏ qua toàn bộ các điểm đã `complete`. Cho dù anh em chạy lại lệnh 50 lần thì số credit tiêu tốn thêm vẫn là **0**.

#### Trụ cột 4: Dry-Run & Smoke Test trước khi bung toàn quốc
- Tuyệt đối không bao giờ chạy full 38 địa điểm ngay lần đầu tiên!
- **Bước 1 (0đ):** Chạy `node src/cli.mjs crawl --dry-run` để kiểm tra danh sách toạ độ, wave, từ khoá và tính hợp lệ của key.
- **Bước 2 (Thử nghiệm 1 địa điểm):** Chạy `node src/cli.mjs crawl --max-locations 1` để kiểm tra format JSON trả về và xác nhận Bright Data key có quyền Dataset hay không.
- **Bước 3 (Bung toàn quốc):** Khi mọi thứ đã chuẩn xác 100%, mới gỡ bỏ cờ giới hạn.

#### Trụ cột 5: Lọc & Deduplicate TRƯỚC KHI xử lý tiếp theo
- Khi quét các vòng tròn toạ độ liền kề (ví dụ Sydney CBD và Parramatta), luôn có khoảng 10% - 20% doanh nghiệp nằm ở vùng giao thoa.
- Bộ lọc `02-process.mjs` sẽ loại bỏ:
  - Doanh nghiệp đã đóng cửa vĩnh viễn / tạm thời.
  - Doanh nghiệp ngoài nước Úc.
  - Doanh nghiệp không có website (nếu mục tiêu là làm sales outreach).
  - Doanh nghiệp trùng lặp theo `place_id`, Google `CID` hoặc cặp `phone + address`.
- Nhờ lọc trước, từ ~3,700 raw records sẽ rút gọn thành ~2,000 unique qualified leads. Điều này giúp tiết kiệm 45% thời gian và tài nguyên cho bước cào email tiếp theo.

#### Trụ cột 6: Cào Email Trực Tiếp với CHI PHÍ = 0 ĐỒNG
- **Sai lầm chết người:** Dùng Bright Data Web Unlocker hoặc Proxy trả phí để cào email từ website doanh nghiệp. Với 2,000 website, bạn có thể tốn $20 - $50 chỉ riêng tiền proxy.
- **Giải pháp của chúng ta:** Sử dụng Native Fetch của Node.js chạy bất đồng bộ đa luồng (`concurrency: 35`) với `timeout: 6000ms`:
  - Gửi request trực tiếp từ IP máy tính (vì các website doanh nghiệp địa phương như salon, phòng khám, công ty vệ sinh không chặn IP thông thường).
  - Tự động dò thêm các đường dẫn vàng: `/contact`, `/contact-us`, `/about`.
  - Tự ngắt ngay khi tìm đủ 1 - 2 email chính thức.
  - Bộ lọc Regex loại bỏ toàn bộ email rác (Wix, Shopify, Sentry, image filenames).
  - **Chi phí giai đoạn này: 0 ĐỒNG.**

---

### 3. Checklist An Toàn Khi Cấp Tài Khoản Mới
Trước khi giao key cho crawler chạy:
1. Đăng nhập Bright Data Dashboard -> Kiểm tra xem account có bật dịch vụ **Datasets** chưa. (Lưu ý: Credit của SERP API không tự động xài được cho Dataset API nếu chưa kích hoạt).
2. Lưu key vào file `~/.config/brightdata/hairfolli_api_keys` hoặc file `.env`.
3. Phân quyền bảo mật file chứa key: `chmod 600 ~/.config/brightdata/hairfolli_api_keys`.
4. Luôn chạy `--dry-run` trước!
