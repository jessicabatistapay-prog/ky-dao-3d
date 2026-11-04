import { useApp } from '../store/appStore';
import { useSettings } from '../lib/settings';
import { Choice, Dialog } from './common';

export function SettingsDialog() {
  const s = useSettings();
  const close = () => useApp.getState().openDialog(null);
  const toggle = (label: string, key: 'particles' | 'shake' | 'reducedMotion' | 'sound' | 'showNames') => (
    <label className="switch">
      <input type="checkbox" checked={s[key]} onChange={(e) => s.set({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <Dialog title="Cài đặt" onClose={close} testId="settings">
      <Choice
        label="Chất lượng hình ảnh"
        value={s.quality}
        options={[{ value: 'low', label: 'Thấp' }, { value: 'medium', label: 'Trung bình' }, { value: 'high', label: 'Cao' }]}
        onChange={(quality) => s.set({ quality })}
      />
      <div className="switches">
        {toggle('Âm thanh', 'sound')}
        {toggle('Hạt hiệu ứng', 'particles')}
        {toggle('Rung camera', 'shake')}
        {toggle('Giảm chuyển động', 'reducedMotion')}
        {toggle('Hiện tên quân khi rê chuột', 'showNames')}
      </div>
      <label className="slider">
        <span>Âm lượng</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.set({ volume: Number(e.target.value) })} />
      </label>
    </Dialog>
  );
}

export function RulesDialog() {
  const close = () => useApp.getState().openDialog(null);
  return (
    <Dialog title="Hướng dẫn và luật chơi" onClose={close} wide testId="rules">
      <div className="prose">
        <h3>Cách chơi</h3>
        <p>Chọn một quân của bạn, các điểm đi được sẽ sáng lên. Chọn điểm đến để đi. Đỏ luôn đi trước. Trên điện thoại, chạm một ngón để chơi, hai ngón để xoay và phóng to.</p>
        <h3>Quân cờ</h3>
        <dl>
          <dt>帥 將 Tướng</dt><dd>Đi một bước ngang hoặc dọc trong cửu cung. Hai Tướng không được nhìn thẳng nhau trên một cột trống.</dd>
          <dt>仕 士 Sĩ</dt><dd>Đi chéo một bước trong cửu cung.</dd>
          <dt>相 象 Tượng</dt><dd>Đi chéo hai bước, không qua sông, bị chặn nếu có quân ở ô giữa (cản mắt).</dd>
          <dt>傌 馬 Mã</dt><dd>Đi theo hình chữ nhật 1×2, bị chặn nếu có quân kề ngay hướng đi (cản chân).</dd>
          <dt>俥 車 Xe</dt><dd>Đi ngang dọc bao nhiêu ô cũng được, không xuyên quân.</dd>
          <dt>炮 砲 Pháo</dt><dd>Đi như Xe. Khi ăn phải nhảy qua đúng một quân làm ngòi.</dd>
          <dt>兵 卒 Tốt</dt><dd>Chỉ tiến trước khi qua sông, sau đó được đi thêm ngang. Không bao giờ lùi.</dd>
        </dl>
        <h3>Kết thúc ván</h3>
        <p>Bên bị chiếu bí thua. Bên đến lượt mà không còn nước hợp lệ cũng thua, kể cả khi không bị chiếu.</p>
        <h3>Luật chơi giải trí</h3>
        <p>Kỳ Đạo 3D áp dụng bộ luật giải trí, không phải luật thi đấu chính thức. Game không xét chiếu dai, đuổi quân và các trường hợp liên quan. Ván được xử hòa khi:</p>
        <ul>
          <li>Một thế cờ lặp lại ba lần, kể cả khi lặp do chiếu liên tục.</li>
          <li>Hai bên đi 60 nước mỗi bên mà không ăn quân.</li>
          <li>Cả hai bên không còn Xe, Pháo, Mã hoặc Tốt.</li>
        </ul>
        <h3>Đồng hồ</h3>
        <p>Giờ chuyển sang đối phương ngay khi nước đi được chấp nhận, thời gian hiệu ứng không được bù lại. Khi đi lại, thời gian đã nghĩ không được hoàn; phần giờ cộng thêm của các nước bị hủy được thu hồi.</p>
        <h3>Chơi online</h3>
        <p>Đồng hồ vẫn chạy khi mất kết nối. Bạn có tối đa 120 giây để kết nối lại; quá thời gian đó bạn bị xử thua do bỏ cuộc. Nếu hết giờ trước, bạn thua do hết giờ.</p>
      </div>
    </Dialog>
  );
}
