export class Chart {
  static instances = {};
  static _nextId = 1;

  static getChart(canvas) {
    return Object.values(Chart.instances).find(chart => chart.canvas === canvas) || null;
  }

  constructor(canvas, config = {}) {
    this.id = String(Chart._nextId++);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = config.data || { datasets: [] };
    this._hover = false;
    Chart.instances[this.id] = this;
    this.update('none');
  }

  reset() {}
  stop() {}

  update() {
    const ctx = this.ctx;
    const w = this.canvas.width || 872;
    const h = this.canvas.height || 436;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = Math.round((h * i) / 5);
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(w - 20, y);
      ctx.stroke();
    }
    const datasets = this.data.datasets || [];
    datasets.forEach((dataset, index) => {
      const color = String(dataset.borderColor || dataset.backgroundColor || '#9CA3AF');
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = this._hover && index === 0 ? 10 : 6;
      ctx.beginPath();
      for (let x = 40; x < w - 20; x += 80) {
        const y = 80 + index * 90 + Math.sin((x + index * 30) / 70) * 35;
        if (x === 40) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = this._hover && index !== 0 ? 0.25 : 0.65;
      ctx.fillRect(60 + index * 220, h - 70, 160, 28);
      ctx.globalAlpha = 1;
    });
  }

  setFixtureHover(value) {
    this._hover = Boolean(value);
    this.update('none');
  }
}

export default Chart;
