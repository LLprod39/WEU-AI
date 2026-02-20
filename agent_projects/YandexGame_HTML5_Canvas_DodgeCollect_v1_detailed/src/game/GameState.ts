export class GameState {
  score: number;
  lives: number;
  time: number;
  difficulty: number;
  usedContinue: boolean;

  constructor(
    score = 0,
    lives = 3,
    time = 0,
    difficulty = 0,
    usedContinue = false
  ) {
    this.score = score;
    this.lives = lives;
    this.time = time;
    this.difficulty = difficulty;
    this.usedContinue = usedContinue;
  }

  reset(): void {
    this.score = 0;
    this.lives = 3;
    this.time = 0;
    this.difficulty = 0;
    this.usedContinue = false;
  }
}
