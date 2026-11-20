import React, { useState } from 'react';

interface SetupConfig {
  region: string;
  autoScale: boolean;
  performanceMode: string;
}

export default function OnboardingWizard() {
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [config, setConfig] = useState<SetupConfig>({
    region: 'auto',
    autoScale: true,
    performanceMode: 'balanced',
  });

  const totalSteps = 3;

  const handleConfigChange = (key: keyof SetupConfig, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  const handleComplete = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await new Promise((resolve, reject) => setTimeout(() => {
        Math.random() > 0.7 ? reject(new Error("Timeout")) : resolve("OK");
      }, 1500));
      alert("初期設定が完了しました！ダッシュボードへ移動します。");
    } catch (error) {
      setErrorMsg("サーバーとの通信がタイムアウトしました。通信環境を確認し、もう一度「設定を完了する」ボタンを押してください。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md mt-10">
      <div className="mb-8">
        <div className="flex justify-between text-sm text-gray-500 mb-2">
          <span>ステップ {step} / {totalSteps}</span>
          <span>{Math.round((step / totalSteps) * 100)}% 完了</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
            style={{ width: `${(step / totalSteps) * 100}%` }}
          ></div>
        </div>
      </div>

      {step === 1 && (
        <div className="animate-fadeIn">
          <h2 className="text-2xl font-bold mb-4">システムへようこそ！</h2>
          <p className="text-gray-600 mb-6">
            数ステップの簡単な質問に答えるだけで、あなたに最適な環境が自動的に構築されます。
          </p>
          <button 
            onClick={() => setStep(2)}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            次へ進む
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fadeIn">
          <h2 className="text-xl font-bold mb-4">基本設定</h2>
          <p className="text-sm text-gray-500 mb-6">※推奨設定がすでに適用されています。</p>
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">接続リージョン</label>
              <select 
                value={config.region}
                onChange={(e) => handleConfigChange('region', e.target.value)}
                className="w-full border-gray-300 rounded-md shadow-sm p-2 border"
              >
                <option value="auto">自動（推奨：最も高速なサーバーを自動選択）</option>
                <option value="jp">日本のみ</option>
                <option value="us">北米</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">パフォーマンスモード</label>
              <select 
                value={config.performanceMode}
                onChange={(e) => handleConfigChange('performanceMode', e.target.value)}
                className="w-full border-gray-300 rounded-md shadow-sm p-2 border"
              >
                <option value="balanced">バランス型（推奨）</option>
                <option value="speed">スピード優先</option>
              </select>
            </div>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => setStep(1)}
              className="w-1/3 bg-gray-200 text-gray-700 py-2 rounded hover:bg-gray-300"
            >
              戻る
            </button>
            <button 
              onClick={() => setStep(3)}
              className="w-2/3 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              確認画面へ
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fadeIn">
          <h2 className="text-xl font-bold mb-4">設定の確認</h2>
          <div className="bg-gray-50 p-4 rounded mb-6">
            <ul className="space-y-2 text-sm">
              <li><strong>リージョン:</strong> {config.region === 'auto' ? '自動最適化' : config.region}</li>
              <li><strong>パフォーマンス:</strong> {config.performanceMode === 'balanced' ? 'バランス型' : config.performanceMode}</li>
            </ul>
          </div>
          {errorMsg && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
              <p className="text-red-700 text-sm">{errorMsg}</p>
            </div>
          )}
          <div className="flex gap-4">
            <button 
              onClick={() => setStep(2)}
              disabled={isLoading}
              className="w-1/3 bg-gray-200 text-gray-700 py-2 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              戻る
            </button>
            <button 
              onClick={handleComplete}
              disabled={isLoading}
              className="w-2/3 bg-green-600 text-white py-2 rounded hover:bg-green-700 flex justify-center items-center disabled:opacity-50"
            >
              {isLoading ? '設定を保存中...' : '設定を完了する'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
